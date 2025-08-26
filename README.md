# Sublime Editor

Простий редактор тексту в стилі Sublime Text, створений з використанням Tauri та Monaco Editor.

## Функції

- ✅ Файловий провідник (sidebar)
- ✅ Система табів для відкритих файлів
- ✅ Мультикурсор редагування
- ✅ Темна тема в стилі Monokai
- ✅ Горячі клавіші як у Sublime Text
- ✅ Підсвічування синтаксису

## Горячі клавіші

- `Cmd/Ctrl + D` - Додати наступне входження в мультикурсор
- `Cmd/Ctrl + Shift + L` - Вибрати всі входження
- `Cmd/Ctrl + S` - Зберегти файл
- `Cmd/Ctrl + Shift + S` - Зберегти як…
- `Cmd/Ctrl + W` - Закрити таб
- `Cmd/Ctrl + Click` - Додати курсор

## Запуск

1. Встановіть залежності:
   ```bash
   npm install
   ```

2. Запустіть в режимі розробки:
   ```bash
   npm run tauri dev
   ```

3. Зборка для продакшену:
   ```bash
npm run tauri build
```

## Іконки застосунку

Використовується `src-tauri/icons/icon.png` як джерело. Для коректних іконок на всіх платформах згенеруйте набір ресурсів:

1) На macOS має бути `sips` і `iconutil` (вбудовано), для Windows `.ico` бажано мати ImageMagick (`convert`).

2) Запустіть:

```bash
npm run icons
```

Скрипт збере PNG різних розмірів (Linux), `.icns` (macOS) і, за наявності ImageMagick, `.ico` (Windows) у `src-tauri/icons/`.

Якщо `.ico` не згенерувався, для Windows можна встановити ImageMagick або скористатися `tauri icon src-tauri/icons/icon.png`.

## Системні вимоги

- Node.js 16+
- Rust 1.60+
- Tauri CLI

## Підтримувані формати файлів

- JavaScript/TypeScript
- Python
- Rust
- Go
- HTML/CSS
- JSON/YAML
- Markdown
- і багато інших...
