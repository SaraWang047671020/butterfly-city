---
inclusion: always
---

# Budget rules

Credits are limited until the 2026-12-05 deadline. Follow these rules in every session:
1. No web research. If a task needs a source, URL, document or number that is not in the repository, stop and list exactly what is needed (what, why, which requirement). The user will provide it.
2. Skip optional tasks marked with `*` unless the user asks for one by number.
3. Do not add dependencies without asking first.
4. Read only the files the current task needs. Do not scan the repository or open large raw data files; use the spec and design to find the right file.
5. Do not run the full test suite after a task; the PostTaskExec hook already runs it. Run single test files only while fixing a specific failure.
6. On a test failure, try at most 2 fixes. If it still fails, stop and report the file, test, expected and received values.
7. Text content (event cards, citizen stories, "Why?" explanations, model limitations page, README) is written by the user. Implement only the code that loads and displays it; use short placeholder text if the content file is missing.
8. Keep reports short: what changed (file list), test result, open questions. Do not restate the spec.
9. When a decision is needed, stop and ask, giving the options and a recommendation in a few lines.
