import * as monaco from 'monaco-editor';
import { themeManager } from '../services/themeManager';
import type { Tab } from '../types';
import { tabsStore } from '../store/tabsStore';
import { appStore } from '../store/appStore';
import { tauriApi } from '../services/tauriApi';
import { t } from '../services/i18n';
import { listen } from '@tauri-apps/api/event';
import { getShortcuts, toMonacoKeyChord } from '../services/shortcuts';

export class Editor {
  private container: HTMLElement;
  private currentEditor?: monaco.editor.IStandaloneCodeEditor;
  private resizeObserver?: ResizeObserver;
  public onContentChanged?: (tab: Tab, content: string) => void;
  private aiTemplates: Array<{ id: string; name: string; instruction: string; effort?: 'minimal'|'low'|'medium'|'high' }>; 
  private lastTabForModal?: Tab;
  // Track the last active tab to re-register macros when templates load asynchronously
  private lastActiveTab?: Tab;

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupResizeObserver();
    this.aiTemplates = this.loadMacros();
    // Try loading macros from persistent config file too (works in dev/prod)
    this.tryLoadMacrosFromFile().then(() => {
      // After async load, ensure actions exist on all editors
      this.registerMacrosOnAllEditors();
    }).catch(()=>{});
  }

  // Breaks input into small segments preferring whitespace boundaries
  private chunkForInsert(s: string, size = 24): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < s.length) {
      const limit = Math.min(i + size, s.length);
      let cut = limit;
      for (let j = limit; j > i + Math.floor(size / 2); j--) {
        if (/\s/.test(s[j - 1])) { cut = j; break; }
      }
      out.push(s.slice(i, cut));
      i = cut;
    }
    return out;
  }

  // Attempts to strip system/meta lines; keep only plain output (preserve spaces and blank lines)
  private sanitizeAiChunk(s: string): string {
    s = s.replace(/\r\n?/g, '\n').replace(/\x1b\[[0-9;]*m/g, '');
    const shouldRemove = (line: string): boolean => {
      const ts = line.trimStart();
      if (ts.startsWith('```')) return true;
      if (/^[-=_]{3,}\s*$/i.test(ts)) return true; // separators like --------
      if (/^---\s*INPUT\s+START\s*---/i.test(ts)) return true;
      if (/^---\s*INPUT\s+END\s*---/i.test(ts)) return true;
      if (/^Return only the transformed text\.?$/i.test(ts)) return true;
      if (/^User instructions\s*:/i.test(ts)) return true;
      if (/^(?:[-=_]{3,}\s*)?(workdir|provider|approval|sandbox|reasoning(\s+effort|\s+summaries)?|usage|model|tokens?|runId)\s*[:=]/i.test(ts)) return true;
      if (/^\[[0-9]{4}-[0-9]{2}-[0-9]{2}[^\]]*\]/.test(ts)) return true; // timestamp/meta lines
      if (/^codex\s*$/i.test(ts)) return true;
      return false;
    };
    const out: string[] = [];
    for (const line of s.split('\n')) {
      if (shouldRemove(line)) continue;
      out.push(line);
    }
    return out.join('\n');
  }
  createEditor(tab: Tab, content: string = ''): monaco.editor.IStandaloneCodeEditor {
    // Create a dedicated DOM element per tab and keep it in the editor container (hidden by default)
    const editorElement = document.createElement('div');
    editorElement.id = `editor-${tab.id}`;
    editorElement.style.width = '100%';
    editorElement.style.height = '100%';
    editorElement.style.display = 'none';
    this.container.appendChild(editorElement);

    const currentTheme = themeManager.getCurrentTheme();
    const editor = monaco.editor.create(editorElement, {
      value: content,
      language: this.detectLanguage(tab.path),
      theme: currentTheme?.editorTheme || 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'bounded',
      wordWrapColumn: 120,
      lineNumbers: 'on',
      glyphMargin: true,
      folding: true,
      selectOnLineNumbers: true,
      matchBrackets: 'always',
      contextmenu: true,
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        includeComments: false,
        includeStrings: false,
        nonBasicASCII: false,
      } as any,
      fontSize: 14,
      fontFamily: 'Consolas, Monaco, Menlo, "Ubuntu Mono", monospace',
      renderWhitespace: 'selection',
      multiCursorModifier: 'ctrlCmd',
      formatOnPaste: true,
      formatOnType: true,
      selectionHighlight: true,
      occurrencesHighlight: 'singleFile' as any,
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'always'
      }
    });

    // Remember for macro registration when needed later
    this.lastActiveTab = this.lastActiveTab || tab;
    this.lastTabForModal = this.lastTabForModal || tab;

    // Set up editor event listeners
    this.setupEditorEvents(editor, tab);

    // Store editor reference in tab
    tabsStore.setTabEditor(tab.id, editor);

    // Register AI action in context menu
    this.registerAiAction(editor, tab);
    // Register macro actions
    this.registerMacroActions(editor, tab);

    return editor;
  }

  private loadMacros(): Array<{ id: string; name: string; instruction: string; effort?: any }> {
    try {
      const raw = localStorage.getItem('editrion.aiTemplates');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) return arr;
    } catch {}
    return [];
  }

  private saveMacros() {
    try { localStorage.setItem('editrion.aiTemplates', JSON.stringify(this.aiTemplates)); } catch {}
    // Also persist to app config dir so it's available across sessions and build/dev origins
    this.trySaveMacrosToFile().catch(()=>{});
  }

  // Public API: return a shallow copy of macros
  public getMacros(): Array<{ id: string; name: string; instruction: string; effort?: any }> {
    return (this.aiTemplates || []).map(m => ({ ...m }));
  }

  // Public API: replace macros, persist and re-register on all editors
  public setMacros(macros: Array<{ id?: string; name: string; instruction: string; effort?: any }>): void {
    const normalized = (macros || []).map(m => ({
      id: m.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
      name: String(m.name || '').trim(),
      instruction: String(m.instruction || ''),
      effort: m.effort || undefined,
    }));
    this.aiTemplates = normalized;
    this.saveMacros();
    this.registerMacrosOnAllEditors();
  }

  private async tryLoadMacrosFromFile(): Promise<void> {
    try {
      const cfgPath = await tauriApi.getCodexConfigPath();
      const dir = cfgPath.replace(/[/\\][^/\\]*$/, '');
      const path = `${dir}/ai_templates.json`;
      const raw = await tauriApi.readFile(path);
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        this.aiTemplates = arr;
        try { localStorage.setItem('editrion.aiTemplates', JSON.stringify(arr)); } catch {}
      }
    } catch {}
  }

  private async trySaveMacrosToFile(): Promise<void> {
    try {
      const cfgPath = await tauriApi.getCodexConfigPath();
      const dir = cfgPath.replace(/[/\\][^/\\]*$/, '');
      const path = `${dir}/ai_templates.json`;
      await tauriApi.writeFile(path, JSON.stringify(this.aiTemplates));
    } catch {}
  }

  private setupEditorEvents(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab): void {
    // Content change detection for dirty state
    editor.onDidChangeModelContent(() => {
      const content = editor.getValue();
      tabsStore.setTabContent(tab.id, content);
      if (this.onContentChanged) this.onContentChanged(tab, content);
    });

    // Cursor position change
    editor.onDidChangeCursorPosition(() => {
      // Could emit events for status bar updates
    });

    // Focus events
    editor.onDidFocusEditorWidget(() => {
      tabsStore.setActiveTab(tab.id);
    });

    // Add common keybindings
    this.setupKeybindings(editor, tab);
  }

  private registerAiAction(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab) {
    editor.addAction({
      id: 'codex.runOnSelection',
      label: (t('menu.item.ai') || 'AI'),
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: async () => {
        try {
          const sel = editor.getSelection();
          const model = editor.getModel();
          const selected = sel && model ? model.getValueInRange(sel) : '';
          this.lastTabForModal = tab;
          const form = await this.showAiInstructionModal();
          if (!form) return;
          const instruction = form.instruction;
          const effValue = (form as any).effort as undefined | 'minimal'|'low'|'medium'|'high';
          await this.runCodex(editor, tab, instruction, effValue, selected);
        } catch (e) {
          console.error('AI action failed:', e);
        }
      }
    });
  }

  private registerMacroActions(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab) {
    const defaultEffort = (() => {
      try { const raw = localStorage.getItem('editrion.aiOverrides'); const saved = raw ? JSON.parse(raw) : {}; return saved.effort as any; } catch { return undefined; }
    })();
    for (const tpl of this.aiTemplates) {
      const actionId = `codex.macro.${tpl.id}`;
      // Avoid duplicate registration per editor instance
      if (editor.getAction(actionId)) continue;
      editor.addAction({
        id: actionId,
        label: `${tpl.name}`,
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.49,
        run: async () => {
          try {
            const sel = editor.getSelection();
            const model = editor.getModel();
            const selected = sel && model ? model.getValueInRange(sel) : '';
            const eff = tpl.effort || defaultEffort;
            await this.runCodex(editor, tab, tpl.instruction, eff, selected);
          } catch (e) { console.error('AI macro failed:', e); }
        }
      });
    }
  }

  private registerMacrosOnAllEditors(): void {
    try {
      const state = tabsStore.getState();
      for (const t of state.tabs) {
        if (t.editor) this.registerMacroActions(t.editor, t as any);
      }
    } catch {}
  }

  private async runCodex(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab, instruction: string, effValue?: 'minimal'|'low'|'medium'|'high', selectedInput?: string) {
    try {
      const sel = editor.getSelection();
      const model = editor.getModel();
      const selected = selectedInput ?? (sel && model ? model.getValueInRange(sel) : '');
      // Determine cwd from tab path
      let cwd: string | undefined;
      if (tab.path) { const parts = tab.path.split(/[/\\]/); parts.pop(); cwd = parts.join('/'); }

      const prompt = `${instruction}\n\n--- INPUT START ---\n${selected}\n--- INPUT END ---\n\nReturn only the transformed text.`;
      // Minimal status overlay with loader
      const streamBox = document.createElement('div');
      streamBox.style.position = 'fixed';
      streamBox.style.bottom = '10px';
      streamBox.style.right = '10px';
      streamBox.style.display = 'flex';
          streamBox.style.alignItems = 'center';
          streamBox.style.gap = '8px';
          streamBox.style.padding = '8px 10px';
          streamBox.style.background = 'rgba(0,0,0,0.75)';
          streamBox.style.color = '#fff';
          streamBox.style.borderRadius = '8px';
          streamBox.style.font = '12px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
          streamBox.style.zIndex = '9999';
          const spinner = document.createElement('div');
          spinner.style.width = '12px';
          spinner.style.height = '12px';
          spinner.style.border = '2px solid rgba(255,255,255,0.35)';
          spinner.style.borderTopColor = '#fff';
          spinner.style.borderRadius = '50%';
          spinner.style.animation = 'editrion-spin 0.8s linear infinite';
          const label = document.createElement('span');
          label.textContent = t('status.runningCodex') || 'Running AI…';
          const btnCancel = document.createElement('button');
          btnCancel.textContent = t('button.cancel') || 'Cancel';
          btnCancel.style.marginLeft = '6px';
          btnCancel.style.padding = '4px 8px';
          btnCancel.style.fontSize = '12px';
          btnCancel.style.borderRadius = '6px';
          btnCancel.style.border = '1px solid rgba(255,255,255,0.25)';
          btnCancel.style.background = 'transparent';
          btnCancel.style.color = '#fff';
          btnCancel.style.cursor = 'pointer';
          streamBox.appendChild(spinner);
          streamBox.appendChild(label);
          streamBox.appendChild(btnCancel);
          document.body.appendChild(streamBox);
          // spinner keyframes
          const styleEl = document.createElement('style');
          styleEl.textContent = '@keyframes editrion-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
          document.head.appendChild(styleEl);

          const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          let outBuf = '';
          let insertedAny = false;
          const originalSelected = selected;
          const hasSelection = !!(sel && model && !sel.isEmpty() && originalSelected.length > 0);
          // Prepare insertion point at caret/start of selection; do not delete selection up-front
          let insertOffset = 0;
          if (model) {
            const caret = editor.getPosition();
            const anchorPos = sel ? sel.getStartPosition() : (caret || model.getFullModelRange().getStartPosition());
            insertOffset = model.getOffsetAt(anchorPos);
          }
          let programmaticEdit = false;
          let userMoved = false;
          const cursorDisp = editor.onDidChangeCursorPosition(() => { if (!programmaticEdit) userMoved = true; });
          // chunking handled by this.chunkForInsert
          const unsubs: Array<() => void> = [];
          const addUnsub = (fn: () => void) => unsubs.push(fn);

          let metaDone = false;
          let pending = '';
          const onStream = await listen<any>('codex-stream', (ev) => {
            const p = ev.payload as { runId?: string; channel?: 'stdout'|'stderr'; data?: string };
            if (!p || p.runId !== runId) return;
            if (p.channel !== 'stdout') return;
            let chunk = (p.data || ''); if (!chunk) return;
            chunk = chunk.replace(/\r\n?/g, '\n');
            pending += chunk;
            let textOut = '';
            if (!metaDone) {
              const m = pending.match(/---\s*INPUT\s+END\s*---/i);
              if (!m) {
                // keep only tail to limit memory, markers won't be longer than 200 chars
                pending = pending.slice(Math.max(0, pending.length - 512));
                return;
              }
              // Drop everything up to and including the END marker
              const idx = (m.index ?? 0) + m[0].length;
              pending = pending.slice(idx);
              // Also drop optional guidance line and timestamp/codex headers immediately following
              // Remove one guidance line
              pending = pending.replace(/^\s*Return only the transformed text\.?\s*/i, '');
              // Remove leading timestamp lines and single 'codex' line
              pending = pending.replace(/^\[[^\]]+\].*\n?/g, '');
              pending = pending.replace(/^\s*codex\s*\n?/i, '');
              metaDone = true;
            }
            if (metaDone && pending) {
              textOut = this.sanitizeAiChunk(pending);
              pending = '';
            }
            if (!textOut) return;
            if (!insertedAny) {
              const trimmedLeft = textOut.replace(/^\s+/, '');
              if (trimmedLeft.length === 0) return;
              textOut = trimmedLeft;
            }
            outBuf += textOut;
            if (!model) return;
            if (!hasSelection) {
              const segments = this.chunkForInsert(textOut, 24);
              const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
              for (const seg of segments) {
                const pos = model.getPositionAt(insertOffset);
                edits.push({ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: seg, forceMoveMarkers: true });
                insertOffset += seg.length;
              }
              if (edits.length) { programmaticEdit = true; editor.executeEdits('codex', edits); programmaticEdit = false; }
              if (!userMoved && model) { const pos = model.getPositionAt(insertOffset); programmaticEdit = true; editor.setPosition(pos); programmaticEdit = false; }
              if (textOut.length > 0) insertedAny = true;
            }
          });
          addUnsub(() => { onStream(); });

          const onDone = await listen<any>('codex-complete', (ev) => {
            const p = ev.payload as { runId?: string; ok?: boolean; output?: string; error?: string };
            if (!p || p.runId !== runId) return;
            unsubs.forEach(fn => fn());
            if (p.ok) {
              const result = this.sanitizeAiChunk((p.output ?? ''));
              if (!model) return;
              const base = outBuf.length > 0 ? outBuf : result;
              const finalText = base.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
              if (hasSelection && sel) {
                const trimmed = finalText.replace(/^\s+/, '').replace(/\s+$/, '');
                programmaticEdit = true; editor.executeEdits('codex', [{ range: sel, text: trimmed, forceMoveMarkers: true }]); programmaticEdit = false;
                if (!userMoved && model) { const startOffset = model.getOffsetAt(sel.getStartPosition()); const endPos = model.getPositionAt(startOffset + trimmed.length); programmaticEdit = true; editor.setPosition(endPos); programmaticEdit = false; }
              } else if (outBuf.length === 0) {
                const trimmed = finalText.replace(/^\s+/, '').replace(/\s+$/, '');
                const segments = this.chunkForInsert(trimmed, 24);
                const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
                for (const seg of segments) {
                  const pos = model.getPositionAt(insertOffset);
                  edits.push({ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: seg, forceMoveMarkers: true });
                  insertOffset += seg.length;
                }
                if (edits.length) { programmaticEdit = true; editor.executeEdits('codex', edits); programmaticEdit = false; }
                if (!userMoved && model) { const pos = model.getPositionAt(insertOffset); programmaticEdit = true; editor.setPosition(pos); programmaticEdit = false; }
              } else {
                // Streamed case: trim trailing whitespace from end of inserted buffer
                const m = finalText.match(/\s+$/);
                if (m) {
                  const trailing = m[0].length;
                  if (trailing > 0) {
                    const endPos = model.getPositionAt(insertOffset);
                    const startPos = model.getPositionAt(insertOffset - trailing);
                    programmaticEdit = true; editor.executeEdits('codex', [{ range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column), text: '' }]); programmaticEdit = false;
                    insertOffset -= trailing;
                    if (!userMoved && model) { const pos = model.getPositionAt(insertOffset); programmaticEdit = true; editor.setPosition(pos); programmaticEdit = false; }
                  }
                }
              }
            }
            else {
              const err = (p.error ?? '').toString();
              console.warn('Codex failed:', err);
              alert('AI failed to run. Please ensure the Codex CLI is installed and available in PATH.\n\n' + err);
            }
            try { document.body.removeChild(streamBox); } catch {}
            try { cursorDisp.dispose(); } catch {}
          });
          addUnsub(() => { onDone(); });

          btnCancel.addEventListener('click', async () => {
            try { await tauriApi.codexCancel(runId); } catch {}
            try { document.body.removeChild(streamBox); } catch {}
            unsubs.forEach(fn => fn());
          });

          // Kick off
          const cfg: Record<string, string> = {};
          if (effValue) cfg['model_reasoning_effort'] = effValue;
          await tauriApi.codexExecStream(prompt, cwd, runId, undefined, cfg);
        } catch (e) {
          console.error('AI action failed:', e);
        }
      }
  
  private async showAiInstructionModal(): Promise<{ instruction: string; effort?: string } | null> {
    // Styled modal to match previous implementation with radios under the textarea
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(0,0,0,0.5)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '10000';

      const box = document.createElement('div');
      box.style.width = 'min(680px, 92vw)';
      box.style.background = 'var(--panel-bg, #1e1e1e)';
      box.style.color = 'var(--text, #fff)';
      box.style.borderRadius = '10px';
      box.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.overflow = 'hidden';

      const header = document.createElement('div');
      header.textContent = t('codex.titleTransform') || 'Codex Transform';
      header.style.padding = '12px 16px';
      header.style.fontSize = '16px';
      header.style.fontWeight = '600';
      header.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

      const body = document.createElement('div');
      body.style.padding = '14px 16px 4px';

      const instr = document.createElement('textarea');
      instr.placeholder = t('codex.instruction.placeholder') || 'e.g., Translate to Ukrainian';
      instr.style.width = '100%';
      instr.style.minHeight = '160px';
      instr.style.maxHeight = '50vh';
      instr.style.overflow = 'auto';
      instr.style.padding = '10px';
      instr.style.borderRadius = '6px';
      instr.style.border = '1px solid rgba(255,255,255,0.1)';
      instr.style.background = 'var(--editor-bg, #252526)';
      instr.style.color = '#e6db74';

      body.appendChild(instr);

      // Reasoning Effort radios below textarea
      const effWrap = document.createElement('div');
      effWrap.style.marginTop = '10px';
      const effLabel = document.createElement('div');
      effLabel.textContent = t('ai.modal.reasoningEffort') || 'Reasoning Effort';
      effLabel.style.fontSize = '12px';
      effLabel.style.opacity = '0.9';
      effLabel.style.marginBottom = '6px';
      const effRow = document.createElement('div');
      effRow.style.display = 'flex';
      effRow.style.gap = '12px';
      const efforts: Array<'minimal'|'low'|'medium'|'high'> = ['minimal','low','medium','high'];
      let effValue: ''|'minimal'|'low'|'medium'|'high' = '';
      try {
        const raw = localStorage.getItem('editrion.aiOverrides');
        const saved = raw ? JSON.parse(raw) : {};
        if (saved && typeof saved.effort === 'string' && efforts.includes(saved.effort)) effValue = saved.effort;
      } catch {}
      if (effValue === '') effValue = 'minimal';
      for (const v of efforts) {
        const lbl = document.createElement('label');
        lbl.style.display = 'flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '6px';
        const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'effort'; rb.value = v;
        if (effValue === v) rb.checked = true;
        rb.addEventListener('change', () => { effValue = v; });
        const span = document.createElement('span');
        span.textContent = t(`ai.modal.reasoningEffort.${v}`) || v;
        lbl.append(rb, span);
        effRow.appendChild(lbl);
      }
      effWrap.append(effLabel, effRow);
      body.appendChild(effWrap);

      // Inline macro save bar (hidden by default)
      const macroBar = document.createElement('div');
      macroBar.style.display = 'none';
      macroBar.style.marginTop = '10px';
      macroBar.style.paddingTop = '6px';
      macroBar.style.borderTop = '1px solid var(--panel-border, rgba(255,255,255,0.12))';
      const macroLabel = document.createElement('label');
      macroLabel.textContent = t('ai.modal.promptTemplateName') || 'Template name:';
      macroLabel.style.fontSize = '12px';
      const macroInput = document.createElement('input');
      macroInput.type = 'text';
      macroInput.style.flex = '1 1 auto';
      macroInput.style.width = '100%';
      macroInput.style.margin = '0 8px';
      // Make input visually match button height
      macroInput.style.padding = '6px 10px';
      macroInput.style.border = '1px solid var(--panel-border)';
      macroInput.style.borderRadius = '4px';
      macroInput.style.background = 'var(--bg)';
      macroInput.style.color = 'var(--text)';
      const macroBtnCancel = document.createElement('button'); macroBtnCancel.className = 'btn'; macroBtnCancel.textContent = t('button.cancel') || 'Cancel';
      const macroBtnSave = document.createElement('button'); macroBtnSave.className = 'btn primary'; macroBtnSave.textContent = t('button.save') || 'Save';
      const hideMacroBar = () => { macroBar.style.display = 'none'; macroInput.value = ''; };
      const doSaveMacro = () => {
        const name = macroInput.value.trim();
        if (!name) { macroInput.focus(); return; }
        const newTpl = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`, name, instruction: instr.value || '', effort: effValue || undefined };
        this.aiTemplates.push(newTpl);
        this.saveMacros();
        // Register on all existing editors so macros appear everywhere immediately
        this.registerMacrosOnAllEditors();
        hideMacroBar();
      };
      macroBtnCancel.addEventListener('click', hideMacroBar);
      macroBtnSave.addEventListener('click', doSaveMacro);
      macroInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSaveMacro(); } if (e.key === 'Escape') { e.preventDefault(); hideMacroBar(); } });
      const macroRow = document.createElement('div');
      macroRow.style.display = 'flex';
      macroRow.style.alignItems = 'center';
      macroRow.style.gap = '8px';
      macroRow.style.marginTop = '6px';
      macroRow.append(macroInput, macroBtnCancel, macroBtnSave);
      const macroWrap = document.createElement('div');
      macroWrap.append(macroLabel, macroRow);
      macroBar.append(macroWrap);
      body.appendChild(macroBar);

      // Save template button (shows inline bar)
      const btnSaveTpl = document.createElement('button');
      btnSaveTpl.className = 'btn';
      btnSaveTpl.textContent = t('ai.modal.saveTemplate') || 'Save as Template';
      btnSaveTpl.addEventListener('click', () => {
        macroBar.style.display = 'block';
        setTimeout(() => macroInput.focus(), 0);
      });

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '10px';
      actions.style.justifyContent = 'flex-end';
      actions.style.padding = '10px 16px 14px';

      const status = document.createElement('span');
      status.textContent = '';
      status.style.opacity = '0.85';
      status.style.fontSize = '12px';
      status.style.marginRight = 'auto';

      const btnCancel = document.createElement('button');
      btnCancel.textContent = t('button.cancel') || 'Cancel';
      btnCancel.style.padding = '8px 12px';
      btnCancel.style.borderRadius = '6px';
      btnCancel.style.border = '1px solid rgba(255,255,255,0.12)';
      btnCancel.style.background = 'transparent';
      btnCancel.style.color = 'inherit';

      const btnRun = document.createElement('button');
      btnRun.textContent = t('button.run') || 'Run';
      btnRun.style.padding = '8px 12px';
      btnRun.style.borderRadius = '6px';
      btnRun.style.border = '1px solid rgba(0,0,0,0)';
      btnRun.style.background = '#3a86ff';
      btnRun.style.color = '#fff';

      const cleanup = (value: { instruction: string; effort?: string } | null) => { overlay.remove(); resolve(value); };
      btnCancel.addEventListener('click', () => cleanup(null));
      btnRun.addEventListener('click', () => {
        btnRun.disabled = true; btnCancel.disabled = true; instr.disabled = true;
        try {
          const raw = localStorage.getItem('editrion.aiOverrides');
          const saved = raw ? JSON.parse(raw) : {};
          saved.effort = effValue || 'minimal';
          localStorage.setItem('editrion.aiOverrides', JSON.stringify(saved));
        } catch {}
        cleanup({ instruction: instr.value || 'Translate to Ukrainian', effort: effValue || undefined });
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
      instr.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); btnRun.click(); }
      });

      actions.appendChild(status);
      actions.appendChild(btnSaveTpl);
      actions.appendChild(btnCancel);
      actions.appendChild(btnRun);
      box.appendChild(header);
      box.appendChild(body);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      setTimeout(() => instr.focus(), 0);
    });
  }


  private setupKeybindings(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab): void {
    const sc = getShortcuts();
    const bind = (comboKey: string, run: () => void) => {
      const combo = sc[comboKey];
      const combos = Array.isArray(combo) ? combo : [combo];
      for (const c of combos) {
        const chord = toMonacoKeyChord(monaco as any, c);
        if (chord != null) editor.addCommand(chord, run);
      }
    };

    // Find: open our panel, close Monaco's
    bind('find', () => {
      try { (window as any).showFind?.(); } catch {}
      try { editor.getAction('closeFindWidget')?.run(); } catch {}
    });
    // Save
    bind('save', () => { this.saveCurrentFile(tab); });
    // Format document
    bind('formatDocument', () => { editor.getAction('editor.action.formatDocument')?.run(); });
    // Quick fix
    bind('quickFix', () => { editor.getAction('editor.action.quickFix')?.run(); });
    // Multi-cursor add to next match
    bind('addCursorToNextMatch', () => { editor.getAction('editor.action.addSelectionToNextFindMatch')?.run(); });
    // Select all occurrences
    bind('selectAllOccurrences', () => { editor.getAction('editor.action.selectHighlights')?.run(); });
    // Delete line
    bind('deleteLine', () => { editor.getAction('editor.action.deleteLines')?.run(); });
    // Toggle comment
    bind('toggleLineComment', () => { editor.getAction('editor.action.commentLine')?.run(); });
    // Duplicate selection(s) after cursor
    bind('duplicateSelection', () => { this.duplicateSelectionsAfterCursor(editor); });
  }

  public duplicateSelectionsAfterCursor(editor: monaco.editor.IStandaloneCodeEditor) {
    const model = editor.getModel(); if (!model) return;
    const sels = editor.getSelections() || [];
    if (!sels.length) return;
    const ordered = sels.slice().sort((a, b) => {
      if (a.endLineNumber === b.endLineNumber) return b.endColumn - a.endColumn;
      return b.endLineNumber - a.endLineNumber;
    });
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    const nextSelections: monaco.Selection[] = [];
    for (const s of ordered) {
      if (s.isEmpty()) continue;
      const text = model.getValueInRange(s);
      const insertPos = { lineNumber: s.endLineNumber, column: s.endColumn };
      const range = new monaco.Range(insertPos.lineNumber, insertPos.column, insertPos.lineNumber, insertPos.column);
      edits.push({ range, text, forceMoveMarkers: true });
      const newPos = advancePos(insertPos, text);
      nextSelections.push(new monaco.Selection(newPos.lineNumber, newPos.column, newPos.lineNumber, newPos.column));
    }
    if (!edits.length) return;
    editor.pushUndoStop();
    editor.executeEdits('duplicateSelection', edits);
    if (nextSelections.length) editor.setSelections(nextSelections);
    editor.pushUndoStop();

    function advancePos(pos: { lineNumber: number; column: number }, text: string) {
      const parts = text.split('\n');
      if (parts.length === 1) return { lineNumber: pos.lineNumber, column: pos.column + parts[0].length };
      const lastLen = parts[parts.length - 1].length;
      return { lineNumber: pos.lineNumber + parts.length - 1, column: lastLen + 1 };
    }
  }

  private async saveCurrentFile(tab: Tab): Promise<void> {
    if (!this.currentEditor || !tab.path) return;

    try {
      const content = this.currentEditor.getValue();
      await tauriApi.writeFile(tab.path, content);
      tabsStore.saveTab(tab.id, content);
    } catch (error) {
      console.error('Failed to save file:', error);
      // Could show notification or emit error event
    }
  }

  switchToTab(tab: Tab): void {
    if (!tab.editor) {
      // Create editor for this tab if it doesn't exist
      // Prefer originalContent when available to avoid extra reads/flicker
      let content = tab.originalContent || '';
      if (!content && tab.path) {
        // Load file content lazily if not preloaded
        this.loadFileContent(tab);
      }
      this.createEditor(tab, content);
    } else {
      // Ensure editor element exists for this tab
      const node = tab.editor.getDomNode();
      if (!node || !node.parentElement) {
        const el = document.getElementById(`editor-${tab.id}`);
        if (el) el.appendChild(node!);
      }
    }

    // Hide all editor elements
    const children = Array.from(this.container.children) as HTMLElement[];
    for (const child of children) child.style.display = 'none';

    // Show active tab's editor element
    let el = document.getElementById(`editor-${tab.id}`) as HTMLElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = `editor-${tab.id}`;
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.display = 'none';
      this.container.appendChild(el);
      // If editor DOM exists, attach it
      if (tab.editor?.getDomNode()) el.appendChild(tab.editor.getDomNode()!);
    }
    el.style.display = 'block';

    // Update current editor ref and layout
    if (tab.editor) {
      this.currentEditor = tab.editor;
      try { tab.editor.updateOptions({ minimap: { enabled: true } as any }); } catch {}
      try { tab.editor.layout(); } catch {}
      try { setTimeout(() => tab.editor?.layout(), 0); } catch {}
      try {
        // Avoid stealing focus from the search field if it is visible
        if (!appStore.getState().searchPanelVisible) {
          tab.editor.focus();
        }
      } catch {}
    }

    // Remember last active tab for macros
    this.lastActiveTab = tab;
    this.lastTabForModal = tab;
  }

  private async loadFileContent(tab: Tab): Promise<void> {
    if (!tab.path) return;

    try {
      const content = await tauriApi.readFile(tab.path);
      if (tab.editor) {
        tab.editor.setValue(content);
      }
      tabsStore.updateTab(tab.id, { originalContent: content });
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  }

  // Search functionality
  // Editor-level search helpers removed (search panel drives the logic)

  // Language detection
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
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
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'md': 'markdown',
      'markdown': 'markdown',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'conf': 'ini',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'sql': 'sql',
      'dockerfile': 'dockerfile',
    };

    return languageMap[ext || ''] || 'plaintext';
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.currentEditor) {
          this.currentEditor.layout();
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  dispose(): void {
    if (this.currentEditor) {
      this.currentEditor.dispose();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  // Utility methods
  getCurrentEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    return this.currentEditor;
  }

  insertText(text: string): void {
    if (this.currentEditor) {
      const selection = this.currentEditor.getSelection();
      if (selection) {
        this.currentEditor.executeEdits('ai-insert', [{
          range: selection,
          text: text,
        }]);
      }
    }
  }

  getSelectedText(): string {
    if (this.currentEditor) {
      return this.currentEditor.getModel()?.getValueInRange(
        this.currentEditor.getSelection()!
      ) || '';
    }
    return '';
  }
}
