---
name: TripSplit
description: Chia tiền du lịch nhóm qua một link chung. Một sổ chi tiêu chung, vui vẻ và rõ ràng.
colors:
  ink: "#023047"
  text-secondary: "#56656E"
  white: "#FFFFFF"
  action: "#FB8500"
  owe-text: "#A84B00"
  get-text: "#0B6F88"
  teal: "#219EBC"
  sun: "#FFB703"
  paper: "#F6FBFE"
  fill: "#EDF5FA"
  selected: "#DCEEF3"
  line: "#D9E8F1"
  attention: "#FFF3D6"
  tag: "#FFEDC2"
typography:
  display:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 800
  body:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  brand:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "3px"
  amount-hero:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
rounded:
  sm: "6px"
  md: "10px"
  lg: "12px"
  card: "14px"
  dialog: "18px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "9px"
  md: "12px"
  gutter: "16px"
  section: "26px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 16px"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "11px 16px"
  pill-on-dark:
    backgroundColor: "rgba(255,255,255,.15)"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "8px 9px"
  pill-on-light:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  pill-on-light-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.get-text}"
    rounded: "{rounded.pill}"
  chip:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  chip-selected:
    backgroundColor: "{colors.get-text}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px"
    height: "44px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "16px"
  notice:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "11px 16px"
---

# Design System: TripSplit

## Overview

**Creative north star: The Travel Ledger.** TripSplit is the shared notebook a group keeps on a trip: who paid for what, who owes whom, and how to settle up with as few bank transfers as possible. Like a good ledger, every screen puts clarity and trust first, because money between friends is sensitive.

**Mood: playful, sunny, social.** The ledger belongs to a holiday, not an office. Personality comes from sunny yellow highlights, the plane logo, ticket and receipt details (the torn total stub, the zig-zag receipt edge), emoji in the fun facts, and warm, casual Vietnamese copy ("Đi chơi cứ vui, tiền nong để app tính"). It never comes at the cost of reading a number correctly.

The app is phone-first: people open a trip from a link in a group chat. Desktop is a wider, two-column version of the same ledger, not a different product.

**Anti-references:** a bank dashboard (cold, dense, intimidating) and a generic AI SaaS page (purple gradients, glassy cards, everything centered).

## Colors

The palette is "Biển" (the sea): one deep navy for structure, one orange for action, teal and deep orange for money direction, and sunny yellow for highlights. It is light-only. Every color is defined once in `lib/colors.js`. Do not write color codes directly in pages.

- **Ink `#023047`** (Prussian navy): main text, the header, the dark toast, and the overlay behind every popup (45–72% opacity).
- **Text secondary `#56656E`**: notes, labels, and placeholders. Passes 4.5:1 on white and on fill.
- **Action `#FB8500`** (UT Orange): **only** the primary button on each screen, the active tab underline, and the expense being edited. Never use it for errors, decoration, or debt.
- **Owe text `#A84B00`** and **get text `#0B6F88`**: the money-direction pair for text ("trả thêm" / "nhận lại"), both passing 4.5:1. Selected chips use get text as their fill.
- **Teal `#219EBC`**: bars, focus rings, and the see-through tints in Bảng chia. It is too light for text.
- **Sun `#FFB703`**: the total in the header, the plane logo, fun-fact cards, help-step numbers, and the error-toast icon. This is where the sunny mood lives.
- **Surfaces:** paper `#F6FBFE` (page), fill `#EDF5FA` (inputs, chips, tip boxes, repayment rows, light buttons), selected `#DCEEF3` (an active light button, text selection), line `#D9E8F1` (borders and dividers).
- **Warm surfaces:** attention `#FFF3D6` (warnings, the bank-name reminder, the panel while editing) and tag `#FFEDC2` (the "CHI TRƯỚC" label, the second fun-fact card). They are the only warm surfaces on a cool page, so they mean "look here".

## Typography

One family, **Be Vietnam Pro** (400 / 500 / 600 / 700 / 800), self-hosted with `next/font`, with full Vietnamese support. All sizes are in `rem` so they follow the reader's browser text size, and they render at the listed pixel sizes by default.

- **Display** 32px / 800: the home page headline only.
- **Headline** 21px / 800: the trip name.
- **Title** 16–17px / 800: section headings ("Hóa đơn tất toán", "Chi tiết từng người") and popup titles.
- **Body** 13.5–15px: list rows, notes, form text. Inputs are always **16px**, because smaller text makes iPhone Safari zoom in.
- **Label** 12–12.5px / 600: field labels, table headers.
- **Brand** 12px / 600, uppercase, 3px letter spacing, 75% opacity: "TRIPSPLIT", always paired with the yellow plane.
- **Amounts** use tabular numbers (`font-variant-numeric: tabular-nums`), so columns of money line up. The "your part" total is 24px / 800.

## Layout

- **Phone (under 900px):** one column, 640px maximum (608px of content) with a 16px gutter. Expenses come first under a compact header. A fixed orange "Thêm khoản chi" button sits at the bottom and opens a bottom sheet. The tab bar spans the full width and stays pinned.
- **Desktop (900px and up):** 1040px maximum (1008px of content). The header, tabs, divider line and content share exactly the same left and right edges.
  - **Header:** "TRIPSPLIT" centered on its own row, then the trip name at the left edge and the total at the right edge.
  - **Buttons:** the four trip buttons move to the right end of the tab bar.
  - **Sổ chi tiêu:** the list and an always-open form side by side (1.35 : 1).
  - **Tổng kết:** two equal columns. The left holds what to act on (your part, receipt, QR codes); the right holds the background (overview, per-person table, fun facts).
  - **Bảng chia:** the expense-name column is 220px wide.
- **Rhythm:** 6–9px inside groups, 12px between fields, 26px above section headings, 24–28px between desktop columns.
- **Tap targets:** every button and link has an invisible tap area of at least 44×44px (in `globals.css`), even when it looks smaller.

## Elevation & Depth

The app uses light layering, not dramatic depth. All shadows are tinted navy, never black.

- **Card:** `0 1px 3px rgba(2,48,71,.08)` (`SHADOW.card`). Used on list rows, cards and stat tiles.
- **Floating panel:** `0 4px 16px rgba(2,48,71,.10)`. The desktop form panel.
- **Primary floating button:** `0 6px 18px rgba(2,48,71,.22)`. The phone "Thêm khoản chi" button.
- **Sheet:** `0 -8px 30px rgba(2,48,71,.18)`.
- **Overlays:** navy at 45% (sheet), 55% (dialogs) and 72% (QR viewer).

## Shapes

Soft and tactile everywhere:
- **Pills (999px):** chips, the header and tab-bar buttons, tags.
- **10px:** inputs and standard buttons.
- **12px:** list rows and stat tiles.
- **14px:** cards.
- **18px:** dialogs and the top of the bottom sheet.

**Ticket motifs (signature details, keep them):**
- **Torn stub:** a striped dashed line beside the total on phones. It's drawn as a background, not a border, because iPhone Safari drops thin dashed borders.
- **Receipt edge:** a zig-zag top on the settlement receipt.

## Components

- **Buttons:**
  - **Primary:** orange with navy text. One per screen region.
  - **Secondary:** fill with navy text.
  - **Dark:** navy with white text, used for "Quét QR" and confirm-delete.
  - **Disabled or saving:** fill with secondary text, never a stray grey.
- **Header pills:** see-through white on navy (phone). Fill-blue pills on the light tab bar (desktop), with an active state in "selected" plus a teal check.
- **Chips (members):** fill. Selected chips use get-text with white text and a check icon. They are real buttons with `aria-pressed`.
- **Inputs:** fill, no border, 44px tall, 16px text, a 2px teal focus ring. The label always sits above the field.
- **List row (expense):** a white card, and the whole row is a button. Repayments use the fill background. The row being edited gets a 2px orange outline.
- **Your-part card:** the top border is deep owe-orange (you pay) or get-teal (you receive). The amount is 24px / 800, followed by one row per transfer with "Quét QR".
- **Receipt:** a zig-zag top edge, rows of "payer → receiver / amount", and your own rows tinted with fill.
- **Toasts:** always navy. Errors add a yellow warning icon and announce themselves to screen readers.
- **Dialogs:** each one is marked as a dialog for screen readers, with a visible title. Focus moves inside on open, stays inside while open, and returns on close (`components/ModalFocus.js`). Esc closes them, except "Bạn là ai", which needs a choice.
- **Hover explanations (`components/Tip.js`):** appear on hover after a short delay, and on keyboard focus. Navy bubbles on light surfaces, white on the navy header.

## Do's and Don'ts

**Do:**
- Keep money readable first: deep orange and teal for amount text, tabular numbers, labels above every field.
- Put playfulness in the details (sun yellow, plane, ticket and receipt edges, fun-fact emoji, casual copy), not in the data.
- Add new colors to `lib/colors.js` with a role comment, and reuse `SHADOW.card` for cards.
- Check new screens at 375px and at 1000px or wider, and keep phone and desktop edges aligned.

**Don't:**
- Use orange for anything except the main action, the active tab, or the expense being edited.
- Add new pale blue or cream shades. Use paper, fill, selected, line, attention and tag.
- Use bright teal `#219EBC` or bright orange `#FB8500` for text, because they fail contrast.
- Set text below 16px in any input, or make any control smaller than its 44px tap area.
- Build a popup without `role="dialog"`, `aria-modal` and a title, because focus management depends on them.
