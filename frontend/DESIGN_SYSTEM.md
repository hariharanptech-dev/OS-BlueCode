# Design system
Colors: CSS-variable tokens in globals.css (ink, paper, card, line, signal, tint, ok, caution, warn) with full light and dark values; signal blue #2F5BEA light / #7A9CFF dark. Dark theme via prefers-color-scheme (background #071126, text #E8EEFB), tokens in globals.css/tailwind.config.ts.
Type: Manrope 400-800. Radius: field 10px, panel 20px. Focus: 2px signal outline. Motion: color transitions only; disabled under reduced-motion.
Components: local primitives in components/ui (Field, Btn). shadcn/ui is NOT used (could not install offline).

Shared classes: .card .input .btn .btn-quiet .muted. One orchestrated motion: hero rise on the landing page. Friendly copy rule: plain verbs, errors say what to do next.
