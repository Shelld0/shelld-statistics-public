Shelld Statistics Public Beta v1.0.4 — исправление GitHub Actions

1. Распакуй патч.
2. Открой GitHub Desktop -> Repository -> Show in Explorer.
3. Скопируй всё содержимое папки патча в КОРЕНЬ репозитория shelld-statistics-public с заменой существующих файлов. Важно: копировать `.gitignore` и папку `tests`, НЕ вложенную папку патча целиком.
4. В GitHub Desktop проверь, что отображаются `.gitignore`, `tests/public-release.test.cjs` и три новых ZIP-файла в `tests/fixtures`.
5. Summary: Fix GitHub Actions tests and Notion fixtures
6. Commit to main -> Push origin.
7. Перейди в GitHub Actions. НОВЫЙ workflow должен пройти npm test, python test, сборку EXE и публикацию GitHub Release v1.0.4-beta.

Патч не изменяет торговые данные, интерфейс, личную редакцию или сборочный пакет.
