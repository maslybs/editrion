// Centralized keyboard shortcuts with simple override support.
// Users can override via localStorage key: 'editrion.shortcuts'
// Example:
// localStorage.setItem('editrion.shortcuts', JSON.stringify({ save: 'Mod+S', duplicateSelection: 'Mod+Shift+D' }))

export type ShortcutMap = Record<string, string | string[]>;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const defaults: ShortcutMap = {
  // App/global
  find: 'Mod+F',
  save: 'Mod+S',
  saveAs: 'Mod+Shift+S',
  preventReload: ['Mod+R', 'F5', 'Shift+Mod+R'],
  // Editor
  addCursorToNextMatch: 'Mod+D',
  selectAllOccurrences: 'Mod+Shift+L',
  deleteLine: 'Mod+Shift+K',
  toggleLineComment: 'Mod+/',
  duplicateSelection: 'Mod+Shift+D',
  quickFix: 'Mod+.',
  formatDocument: isMac ? 'Shift+Alt+F' : 'Shift+Alt+F',
};

export function getShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem('editrion.shortcuts');
    if (raw) {
      const user = JSON.parse(raw);
      if (user && typeof user === 'object') {
        return mergeMaps(defaults, user as ShortcutMap);
      }
    }
  } catch {}
  return { ...defaults };
}

function mergeMaps(base: ShortcutMap, override: ShortcutMap): ShortcutMap {
  const out: ShortcutMap = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = Array.isArray(v) ? [...v] : String(v);
  }
  return out;
}

export function matchesDomEvent(e: KeyboardEvent, combo: string): boolean {
  const spec = normalizeCombo(combo);
  if (!spec) return false;
  const { key, mod, shift, alt, ctrl, cmd } = spec;

  const modDesired = mod || false;
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (!!modDesired !== !!modPressed) return false;
  if (!!shift !== !!e.shiftKey) return false;
  if (!!alt !== !!e.altKey) return false;
  if (ctrl) { if (!e.ctrlKey) return false; }
  if (cmd) { if (!e.metaKey) return false; }

  const ek = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const kk = key.length === 1 ? key.toUpperCase() : key;
  return ek === kk;
}

export function normalizeCombo(combo: string): { key: string; mod?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean; cmd?: boolean } | null {
  if (!combo) return null;
  const parts = combo.split('+').map(s => s.trim()).filter(Boolean);
  let key = '';
  let mod = false, shift = false, alt = false, ctrl = false, cmd = false;
  for (const p of parts) {
    const u = p.toLowerCase();
    if (u === 'mod') mod = true;
    else if (u === 'shift') shift = true;
    else if (u === 'alt' || u === 'option') alt = true;
    else if (u === 'ctrl' || u === 'control') ctrl = true;
    else if (u === 'cmd' || u === 'meta') cmd = true;
    else key = mapKeyName(p);
  }
  if (!key) return null;
  return { key, mod, shift, alt, ctrl, cmd };
}

function mapKeyName(k: string): string {
  const up = k.toUpperCase();
  // Common aliases
  if (up === 'ESC') return 'Escape';
  if (up === 'RETURN') return 'Enter';
  if (up === 'DEL') return 'Delete';
  if (up === 'BKSP') return 'Backspace';
  // Function keys
  if (/^F\d{1,2}$/.test(up)) return up;
  if (up.length === 1) return up;
  return up;
}

// Map our simple combos to Monaco keycodes for editor.addCommand
export function toMonacoKeyChord(monacoNS: any, combo: string): number | null {
  const spec = normalizeCombo(combo);
  if (!spec) return null;
  let acc = 0;
  if (spec.shift) acc |= monacoNS.KeyMod.Shift;
  if (spec.alt) acc |= monacoNS.KeyMod.Alt;
  // If combo uses Mod, pick platform key
  if (spec.mod) acc |= monacoNS.KeyMod.CtrlCmd;
  if (spec.ctrl) acc |= monacoNS.KeyMod.CtrlCmd; // simple approximation
  if (spec.cmd) acc |= monacoNS.KeyMod.CtrlCmd;
  const keyCode = keyToMonacoKeyCode(monacoNS, spec.key);
  if (keyCode == null) return null;
  return acc | keyCode;
}

function keyToMonacoKeyCode(monacoNS: any, key: string): number | null {
  const map: Record<string, number> = {
    'A': monacoNS.KeyCode.KeyA,
    'B': monacoNS.KeyCode.KeyB,
    'C': monacoNS.KeyCode.KeyC,
    'D': monacoNS.KeyCode.KeyD,
    'E': monacoNS.KeyCode.KeyE,
    'F': monacoNS.KeyCode.KeyF,
    'G': monacoNS.KeyCode.KeyG,
    'H': monacoNS.KeyCode.KeyH,
    'I': monacoNS.KeyCode.KeyI,
    'J': monacoNS.KeyCode.KeyJ,
    'K': monacoNS.KeyCode.KeyK,
    'L': monacoNS.KeyCode.KeyL,
    'M': monacoNS.KeyCode.KeyM,
    'N': monacoNS.KeyCode.KeyN,
    'O': monacoNS.KeyCode.KeyO,
    'P': monacoNS.KeyCode.KeyP,
    'Q': monacoNS.KeyCode.KeyQ,
    'R': monacoNS.KeyCode.KeyR,
    'S': monacoNS.KeyCode.KeyS,
    'T': monacoNS.KeyCode.KeyT,
    'U': monacoNS.KeyCode.KeyU,
    'V': monacoNS.KeyCode.KeyV,
    'W': monacoNS.KeyCode.KeyW,
    'X': monacoNS.KeyCode.KeyX,
    'Y': monacoNS.KeyCode.KeyY,
    'Z': monacoNS.KeyCode.KeyZ,
    'UP': monacoNS.KeyCode.UpArrow,
    'DOWN': monacoNS.KeyCode.DownArrow,
    'LEFT': monacoNS.KeyCode.LeftArrow,
    'RIGHT': monacoNS.KeyCode.RightArrow,
    'ESCAPE': monacoNS.KeyCode.Escape,
    'ENTER': monacoNS.KeyCode.Enter,
    '/': monacoNS.KeyCode.Slash,
    '.': monacoNS.KeyCode.Period,
    'F5': monacoNS.KeyCode.F5,
  };
  const name = key.length === 1 ? key.toUpperCase() : key.toUpperCase();
  return name in map ? map[name] : null;
}

