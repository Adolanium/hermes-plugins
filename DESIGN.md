# Design record

The catalog helps Hermes users compare Adolanium's public plugins and reach their source and installation instructions. Themes, pets, all forks, Hermes core and development tools are outside its scope.

## Visual direction

A charcoal green background (`#111714`) and soft off-white text (`#e4eae3`) carry the dark page. Secondary text (`#a6b4a9`) remains legible. Pale green accents (`#a6d6ad`) identify links and focus; selected controls use a light green fill with dark text. Input and command surfaces are slightly lighter than the canvas. Native controls use the dark color scheme. Thin rules separate directory entries. Images appear where public screenshots or demos are available. Previews use optimized static stills, with a caption linking to the original screenshot or demo. Demo frames show useful results rather than empty opening screens.

Georgia headings give names and the introduction a distinct hierarchy. Arial handles descriptions, metadata and controls; Consolas handles installation commands. System fonts keep the static page independent of font services.

## Layout and interaction

The centered page has a 1200px maximum width. The desktop introduction uses two columns. Plugin rows pair descriptive text with a 300px preview when available; rows without images use a narrower text column. Repository links and expandable installation details sit below each description.

Search combines with one active category filter. The result count updates as the user types or changes categories. An empty result offers a reset that clears both controls and returns focus to search. Copy controls report success or explain how to copy manually if clipboard access fails.

At 760px and below, the introduction and plugin rows become a single column, page padding decreases and the footer stacks. Category buttons wrap. Screenshots retain their proportions and installation commands wrap to fit.

## Accessibility and delivery

The page uses a skip link, semantic landmarks, a visible search label and native buttons and disclosure controls. Category buttons expose their selected state through `aria-pressed`. Result counts and clipboard feedback use status regions. Keyboard focus receives a visible green outline. Filter buttons have a 44px minimum height, and their brief color transitions run only when reduced motion is not requested.

The catalog remains readable without JavaScript. Search and filters appear when the script runs. Public repository data supplies the generated entries, and the footer records the refresh date. Installation guidance follows each repository's documented requirements.
