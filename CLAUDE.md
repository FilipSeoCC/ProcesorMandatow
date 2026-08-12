@AGENTS.md

## Priorytet do dokończenia: wysyłka e-mail z aplikacji

Aktualny endpoint `POST /api/documents/[id]/review-package` wysyła przez
Resend pakiet sprawy wyłącznie na adres zalogowanego pracownika. To jest
bezpieczny etap MVP: pracownik otrzymuje gotowy szkic i sam decyduje, czy
przesłać go klientowi.

Kolejny etap do zaprojektowania i wdrożenia w UI oraz backendzie:

- utworzenie oraz edycja szkicu wiadomości do klienta z danych sprawy,
- ekran akceptacji z widocznym odbiorcą, treścią i załącznikami,
- dopiero po świadomym zatwierdzeniu pracownika wysyłka na e-mail klienta,
- zapis statusu, identyfikatora dostawcy e-mail, daty oraz użytkownika w
  historii sprawy; brak automatycznej wysyłki wyłącznie na podstawie OCR,
- obsługa błędu, ponowienia i blokada podwójnej wysyłki.

Nie wysyłaj pisma do klienta automatycznie po OCR lub samym dopasowaniu auta.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` before committing (AST-only, no API cost). Commit the portable `graphify-out/` files together with the code so Codex and Claude receive the same graph after pulling the branch.
- Do not commit Graphify caches, backups, `graph.html`, `.graphify_python`, `.graphify_root` or local hook configuration; these remain machine-specific. On a new clone run `graphify hook install` once.
