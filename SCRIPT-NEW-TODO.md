# Script New — TODO

This file tracks the refactor from `gm-script.html` → `script-new.html` and the remaining tasks to make the scripts page modular and easy to extend.

1. Create `script-new.html` — completed
   - Copy of `gm-script.html` embedded via iframe and runtime injection created: `script-new.html` (preserves modals and notepad).

2. Add semantic classes and IDs — not started
   - Add `.product-section` to each product category (e.g., `cultivator-section`, `husker-section`).
   - Add `.sub-script` to each inner script block (e.g., `script-kns`, `script-husker-mounted`).

3. Implement universal selectors — completed (injection)
   - `selectProduct(productType, btnElement)` and `selectSubScript(scriptId, btnElement)` injected at runtime by `script-new.html`.
   - Legacy selector mapping implemented to preserve existing inline onclicks.

4. Replace inline onclicks — not started
   - Replace inline handlers with `data-*` attributes or remove them and use event delegation to call unified functions.

5. Preserve notepad & modals — completed
   - Notepad autosave and modal HTML/JS are preserved by embedding `gm-script.html`.

6. Add SpringHarrow product — not started
   - Integrate "Пружинна борона 9м" with two variants (Штригель / Класика) following the new structure.

7. Remove legacy selection functions — not started
   - After testing, remove duplicate/legacy functions from the codebase.

8. Add README and usage examples — not started
   - Short README explaining how to add `product-section` and `sub-script` blocks without touching JS.

9. Test & verify — not started
   - Manual browser QA: switching, modals, notepad localStorage, console checks, cross-origin checks.

---

Files touched so far:
- script-new.html (created)
- SCRIPT-NEW-TODO.md (this file)

Next steps: pick task #2 or #4 to continue the refactor. For an atomic change I can (A) update `gm-script.html` inline onclicks to use `data-*` attributes and leave JS mapping in place, or (B) perform a full HTML transform to rename classes/ids and remove legacy functions. Tell me which approach you prefer.