# Design record

The site helps Hermes users find the plugins listed in the Hermes plugin catalog, see what each one does, and copy the commands that install it. Only catalog entries appear; nothing here lists a plugin the catalog has not admitted.

## Visual direction

The page follows the Nous Research portal look that the plugin banners use. A flat midnight indigo canvas (`#04003a`) carries a faint 6px dot screen. Text is near-white lavender (`#f1f0ff`), secondary text periwinkle (`#aeacec`), and the accent pale periwinkle (`#c9c8ff`); all three pass WCAG AA on the canvas. There are no other hues, gradients or glows. Colour comes from the dithered banner art.

Every plugin is a retro window: a thin frame, a title bar with the catalog name and three small square buttons, the plugin's 2:1 banner, then the text. Georgia carries the hero and plugin names; a system monospace stack carries everything else, so the page needs no font service.

## Layout and interaction

The page is centred at 1240px. The hero pairs the headline with the collection banner in a window frame. A three-cell facts strip follows. Plugin windows sit in an auto-filling grid (340px minimum), one column on phones. Each window shows category, version and pinned commit, the summary, required environment variables, the install and enable commands with a copy button, an optional "What it touches" disclosure taken from the catalog description, and links to the catalog page, source and any screenshot or demo.

Search combines with one category filter. The result count updates as the user types; an empty result offers a reset that clears both and returns focus to search. Plugin names in commands never break across lines. Cards lift slightly on hover or focus unless reduced motion is requested.

## Accessibility and delivery

Skip link, landmarks, a visible search label, native buttons and disclosures, `aria-pressed` on filters, status regions for counts and clipboard feedback, and a visible focus outline. Filter buttons are at least 44px tall. The page reads fully without JavaScript; search and filters appear when the script runs.
