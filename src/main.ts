import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import './style.css';
import { App } from './app/App';

// Bootstrap the refactored App per IMPROVEMENTS_TZ
const app = new App();

// Optional globals for native menu bindings
(window as any).createNewFile = () => app.createNewFile();
(window as any).openFile = () => app.openFile();
(window as any).openFolder = () => { /* handled by menu via FileExplorer */ };
(window as any).saveActiveFile = () => app.saveActiveFile();
(window as any).showFind = () => { /* handled via SearchPanel */ };
(window as any).showReplace = () => { /* TODO */ };
(window as any).selectAllOccurrences = () => { /* TODO */ };

// Tab closing API for components
(window as any).requestCloseTab = (id: string) => app.closeTab(id);
(window as any).requestCloseAll = () => app.closeAllTabs();
(window as any).requestCloseOthers = (keepId: string) => app.closeOtherTabs(keepId);
(window as any).requestCloseRight = (keepId: string) => app.closeTabsToRight(keepId);

export default app;
