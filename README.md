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