# HR & Payroll — Design System

Single source of truth for the visual language across the **Android app** (Jetpack
Compose) and the **Master Control web app** (Next.js + Tailwind/shadcn). The look
is anchored to the reference mockups in `UI /1.webp`: indigo gradient headers,
floating white cards on a lavender canvas, pill status chips, generous radii.

When adding UI, use these tokens — never ad-hoc hex values or raw Tailwind
`bg-*-50` colors (they break in dark mode).

---

## 1. Brand palette

| Token | Hex | Compose (`ui/theme/Color.kt`) | Web |
|---|---|---|---|
| Brand Violet (gradient start) | `#6C5CE7` | `BrandViolet` | `.brand-gradient` stop 0% |
| Brand Indigo (primary) | `#5B4FC4` | `BrandIndigo` / `colorScheme.primary` | `--primary` (247 51% 55%) |
| Brand Indigo Dark (gradient end) | `#463AA8` | `BrandIndigoDark` | `.brand-gradient` stop 100% |
| Lavender (tint surfaces) | `#EFEEFB` | `BrandLavender` / `primaryContainer` | `--accent`, `.brand-gradient-soft` |
| Canvas background | `#F7F6FC` | `BrandSurface` / `background` | `--background` (248 40% 98%) |
| Ink (text) | `#1C1B2E` | `onBackground` / `onSurface` | `--foreground` (248 30% 14%) |

**Signature gradient** — used on every screen header, the login canvas, the web
sidebar and page heroes:
- Compose: `BrandGradient` (vertical Violet → Indigo → IndigoDark)
- Web: `.brand-gradient` (`linear-gradient(155deg, #6c5ce7, #5b4fc4 45%, #463aa8)`)

## 2. Status palette (chips)

One palette serves attendance, claims and admin roles. Five color roles:

| Role | Used for | FG / BG (light) | Compose | Web class |
|---|---|---|---|---|
| **Emerald** | Present · Approved · Payroll Admin | `#16A34A` / `#DCFCE7` | `StatusPresent` / `StatusPresentBg` | `.chip-present` |
| **Indigo** | Leave · Needs Clarification · HR Manager | `#4F46E5` / `#E0E7FF` | `StatusLeave` / `StatusLeaveBg` | `.chip-leave` |
| **Rose** | Off Day · Rejected · Super Admin · errors | `#E11D48` / `#FFE4E6` | `StatusOff` / `StatusOffBg` | `.chip-off` |
| **Amber** | Half Day · Pending · Branch Manager | `#B45309` / `#FEF3C7` | `StatusHalf` / `StatusHalfBg` | `.chip-half` |
| **Sky** | Paid (claim disbursed) · Cashier · info | `#0284C7` / `#E0F2FE` | `StatusPaid` / `StatusPaidBg` | `.chip-paid` |

Web chips are **dark-mode safe** (each `.chip-*` carries `dark:` variants) —
that's why pages must use the classes from `globals.css`, not inline colors.

Chip anatomy: pill (full radius), 12sp/xs semibold text, tinted bg + strong fg.
Compose: `ui/components/StatusChip`. Web: `<span className="chip chip-present">`.

## 3. Typography

System sans on both platforms (Roboto on Android, Tailwind default stack on web).

| Level | Size / weight | Compose (`BrandTypography`) | Web |
|---|---|---|---|
| Wordmark / splash | 26 bold | `headlineMedium` | `text-2xl font-bold` |
| Screen title (header) | 22 bold | `titleLarge` | `text-2xl font-bold tracking-tight` (PageHero) |
| Card / section title | 16 bold | `titleMedium` | `text-base font-bold` |
| List item title | 14 semibold | `titleSmall` | `font-semibold` |
| Body | 13–15 regular | `bodyMedium` / `bodyLarge` | `text-sm` |
| Metadata / secondary | 12 regular, 60 % ink | `bodySmall` + alpha 0.6 | `text-xs text-muted-foreground` |
| Buttons | 14 semibold | `labelLarge` | `text-sm font-semibold` |
| Field labels / chips | 11–12 medium | `labelMedium` / `labelSmall` | `text-xs font-medium` |

## 4. Shape, elevation, spacing

| Token | Android | Web |
|---|---|---|
| Radius S (inputs, small buttons) | 12dp (`shapes.small`) | `rounded-xl` |
| Radius M (cards, buttons) | 20dp (`shapes.medium`) | `rounded-2xl` (`--radius: 1rem`) |
| Radius L (hero cards, header bottom) | 28dp (`shapes.large`) | `rounded-2xl` + hero |
| Card elevation | 2dp list cards · 6dp floating hero card | `.card-soft` (soft indigo shadow) |
| Screen padding | 16dp | `p-4`/`p-6` |
| Card padding | 14–18dp | `p-4`/`p-5` |
| Gap between cards | 10–12dp | `space-y-3` / `gap-4` |

## 5. Signature layout patterns

- **Gradient header** — every mobile screen starts with `BrandHeader` (140dp
  gradient, 28dp rounded bottom corners, centered white title). Web pages start
  with `PageHero` (gradient card, title + subtitle + action slot).
- **Floating card** — the first content card overlaps the header
  (`offset(y = (-20..-24).dp)` on Android) with elevation 6dp, like the reference.
- **Stat tiles** — 2-up/4-up grid of white cards: big number (colored by meaning),
  tiny muted label underneath (`StatCard` on web dashboard/claims).
- **Money highlight** — mint-tinted panel (`#DCFCE7`-family) for salary/amount
  totals; indigo-tinted (`#EEF0FF`) for amount boxes on vouchers.
- **Forms** — labelled outlined fields, radius S. **Enumerations are always
  dropdowns** (claim type, leave type); **dates always use the date picker** —
  never free text.
- **Thread bubbles** (claim clarification) — admin messages left, indigo-tinted;
  employee replies right, muted; 10–12px sender + timestamp caption.

## 6. Theme mode

**Always light, by owner decision.** The Android theme forces `darkTheme = false`
(system dark mode is ignored); the web never applies the `.dark` class
(`darkMode: 'class'`, no toggle). Dark schemes (`DarkColors`, `.dark` vars,
`dark:` chip variants) are kept in the codebase so dark mode can be re-enabled
later, but no new UI should depend on it.

**Print output is monochrome**: PDFs meant for paper (claim voucher) are pure
black-on-white — no color fills, no tints — to keep printing cheap.

## 7. Component inventory

| Component | Android | Web |
|---|---|---|
| Gradient header | `ui/components/BrandHeader` | `components/page-hero.tsx` |
| Status chip | `ui/components/StatusChip` | `.chip .chip-*` |
| Card | M3 `Card` + tokens above | `components/ui/card.tsx` / `.card-soft` |
| Primary button | M3 `Button` (radius M, 52–54dp tall) | `components/ui/button.tsx` / `.brand-gradient` CTA |
| Enum dropdown | `ExposedDropdownMenuBox` (see ClaimSubmit / Leave) | native `<select>` styled `h-9 rounded-lg` |
| Date input | `DatePickerDialog` (see LeaveScreen) | `<input type="date">` |
| Detail dialog | M3 `AlertDialog` (see MyClaims) | fixed-overlay card (see claims page) |

## 8. Voice

Short, human microcopy: "Tap to reply", "No claims in this view.", "Verified ✓".
Amounts in ₹ on screens (`₹1,250`), `Rs.` in PDFs (standard PDF fonts lack ₹).
Dates: `14 Jul 2026, 03:20 pm` (device timezone) on detail views, `14 Jul` in lists.
