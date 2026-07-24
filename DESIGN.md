---
omd: 0.1
brand: REFLO
bootstrapped_from: speeda
bootstrapped_at: 2026-07-21T00:00:00+09:00
---

# Design System Inspiration of REFLO

## 1. Visual Theme & Atmosphere

REFLO is a Korean B2B research workspace. It should feel like a serious research instrument: a white working canvas, soft neutral bands, near-black ink, and one vivid lime signal for selection, progress, and completion. The interface is information-dense but never cramped. Hierarchy comes from typography, spacing, tint, and hairlines rather than decorative elevation.

**Key characteristics**

- Preserve the existing REFLO black-and-lime identity.
- Use flat white and `#f5f7f3` surfaces with `#e4e8e1` hairlines.
- Keep content cards at 10–12px radius and controls at 8–10px unless an established component differs.
- Reserve saturated lime for active, selected, confirmed, and primary-next states.
- Prefer concise, action-led Korean copy and visible provenance.

## 2. Color Palette & Roles

### Primary

- **REFLO Lime** (`#c8ff3d`): active step markers, selected states, progress, and confirmation actions.
- **Lime Deep** (`#75a900`): readable accent text and focus borders on light surfaces.
- **Lime Tint** (`#efffc5`): selected or informative low-pressure backgrounds.

### Neutral & Surface

- **Paper** (`#ffffff`): primary working surface.
- **Soft** (`#f5f7f3`): grouped and inset surfaces.
- **Hairline** (`#e4e8e1`): dividers, outlines, and table rules.

### Text Hierarchy

- **Ink** (`#111410`): headings and primary content.
- **Muted** (`#697066`): supporting copy and metadata.
- **Faint** (`#8b9387`): disabled and lowest-emphasis labels.

### On-color

- **On Lime** (`#111410`): text and icons on lime.
- **On Ink** (`#ffffff`): text and icons on near-black actions.

## 3. Typography Rules

### Font Family

- Use `var(--font-geist-sans), "Pretendard", "Noto Sans KR", Arial, sans-serif` throughout.

### Hierarchy

| Role | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| Page display | 40–56px | 500–650 | 1.15 | Step title |
| Section head | 20–24px | 650 | 1.35 | Main work groups |
| Card head | 14–16px | 650 | 1.45 | Item and question titles |
| Body | 13–14px | 400–500 | 1.55 | Instructions and values |
| Metadata | 10–12px | 600 | 1.45 | Counts, provenance, status |

### Principles

- Establish hierarchy with size, color, and spacing before adding weight.
- Keep Korean body text at 1.5 or greater line height.
- Use tabular numerals for financial values and counts.
- Keep helper copy shorter and quieter than the action it explains.

## 4. Component Stylings

### Buttons

- Primary completion buttons use lime with near-black text and at least a 44px target.
- Neutral inspection and editing actions use white or ink; they must not compete with completion.
- Labels describe the result or panel opened, not implementation details.

### Inputs & Forms

- White background, `1px solid #e4e8e1`, 8–10px radius, ink text, visible lime-deep focus state.
- Editable values must look like inputs; read-only evidence must not resemble a selectable control.

### Cards & Containers

- White surface, 10–12px radius, hairline outline, no decorative shadow.
- Internal order: purpose/state → title/value → supporting provenance → action.
- Omit redundant count badges or helper banners when the same information is already visible.

### Badges

- Use small pills only for compact state or purpose metadata.
- Do not use status pills as a substitute for a clear selected-tab treatment.

### Navigation

- Tabs fill their container when appropriate.
- Selected tabs use a clean underline and solid marker; selectable tabs remain visibly actionable.
- Workflow steps remain consecutive and grouped 2–2–3.

### Footer

- Bottom action bars remain visually quiet until the primary next or completion action.

## 5. Layout Principles

### Spacing System

- Base rhythm: 4, 8, 12, 16, 24, 32, 40px.
- Use 24–32px between major content groups and 12–16px inside cards.

### Grid & Container

- Prefer one dominant reading column for planning and a split list/evidence workspace for verification.
- Keep related purpose tabs, filters, and content inside one shared bounded surface.

### Whitespace Philosophy

- Density serves scanning, not compression.
- Use blank space to separate decisions; use hairlines to separate records.

### Border Radius Scale

- 8px controls, 10–12px cards, 16–18px large dialogs, full pills only for compact states.

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat | Paper or soft surface | Default content |
| Hairline | `1px solid #e4e8e1` | Cards, lists, inputs |
| Overlay | Restrained shadow only | Dialogs and temporary overlays |

Avoid shadow-stacked work cards. Group with tint, borders, and spacing.

## 7. Do's and Don'ts

### Do

- Show the same purpose taxonomy across planning and verification.
- Explain the role difference between steps 04 and 05 in one short sentence.
- Preserve exact source and usage context near research data.
- Make active, included, excluded, and complete states recognizable without color alone.

### Don't

- Repeat the same helper explanation in both a header and a toolbar.
- Hide a multi-purpose workflow inside one undifferentiated long list.
- Add decorative badges, heavy shadows, or multiple saturated accent colors.
- Let compact text or controls reduce legibility below the established preference baseline.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key changes |
|---|---:|---|
| Mobile | <640px | Stack tabs and content; full-width actions |
| Tablet | 640–1024px | Compact spacing; preserve horizontal purpose tabs when readable |
| Desktop | >1024px | Full workflow sidebar and work surface |

### Touch Targets

- Interactive controls should provide a 44px target or equivalent padded hit area.

### Collapsing Strategy

- Preserve purpose order: 보고서 구성 → 가설 확인 → Excel 입력값.
- Stack content rather than shrinking labels below readable size.

### Image Behavior

- Evidence previews remain contained and scrollable; never distort source material.

## 9. Agent Prompt Guide

### Quick Color Reference

- Primary: `#c8ff3d`
- Primary deep: `#75a900`
- Primary tint: `#efffc5`
- Ink: `#111410`
- Muted: `#697066`
- Hairline: `#e4e8e1`
- Soft: `#f5f7f3`
- Paper: `#ffffff`

### Example Component Prompts

- “Build a three-purpose tab group on white with a hairline bottom edge. Use a clean near-black underline and a solid lime step marker for the selected tab; show counts as secondary text.”
- “Build a research item card with purpose and inclusion state first, a readable title second, provenance third, and one explicit ‘자료·출처 설정’ action.”

### Iteration Guide

1. Clarify taxonomy and task order.
2. Remove repeated copy and badges.
3. Strengthen type hierarchy and target sizes.
4. Verify keyboard state, pressed state, and responsive behavior.
5. Confirm the planning and verification surfaces use the same labels.

## 10. Voice & Tone

REFLO is authoritative, calm, and efficiency-focused. Korean copy is concise and declarative. It tells the analyst what is being set, checked, or carried forward. Use concrete nouns such as 자료, 출처, 원문, 입력값, 확인, and 반영. Avoid hype, vague AI claims, and redundant positional explanations.

## 11. Brand Narrative

REFLO brings research work into one continuous flow from project setup and source collection through validation, valuation, and report preparation. Its visible product line is “Research, in one flow.”

<!-- omd:limitation Reference §11 requires additional project-specific historical facts. Add founding context before external brand publication; do not fabricate. -->

## 12. Principles

1. **One flow, shared language.** The same purpose labels should connect setup, collection, and validation.
2. **Credibility through provenance.** Values remain connected to sources and original locations.
3. **One signal color.** Lime marks the state that deserves immediate attention.
4. **Flat and trustworthy.** Hairlines and surface tint communicate structure without decorative depth.
5. **Calm where it informs.** Dense professional work remains readable and action-led.

## 13. Personas

### MVP primary user

- 국내 상장사의 분기 실적, 투자 가설, Evidence, PER 밸류에이션과 리서치 보고서를 한 흐름에서 작성하는 금융 리서치 애널리스트
- 원본 PDF·Excel의 구조를 유지하면서 출처, 계산과 사용자 판단을 추적해야 하는 사용자
- 빠른 초안보다 재현 가능한 숫자, 원문 provenance와 최종 승인 통제를 우선하는 사용자

리서치 팀 검토자, 운영자와 고객 관리자 persona는 실제 사용 범위가 검증된 뒤 추가한다.

## 14. States

| State | Treatment |
|---|---|
| Empty | Plain explanation and one next action |
| Loading | Skeleton at final dimensions; prior context remains visible |
| Error | Specific reason and recovery action |
| Success | Lime confirmation with result-oriented copy |
| Selected | Underline, solid marker, and ARIA-selected state |
| Included | Checkmark plus explicit included label |
| Disabled | Muted color while preserving readable contrast |

## 15. Motion & Easing

- Fast: 120ms for hover, press, and focus.
- Standard: 200ms for tabs, panels, and dialogs.
- Slow: 320ms for page-level transitions.
- Use steady easing (`cubic-bezier(0.25, 0.1, 0.25, 1)`), no bounce.
- Under `prefers-reduced-motion: reduce`, transitions collapse to instant.

## 16. Canonical UI Corrections

`.omd/preferences.history.md`의 사용자 교정 245건은 2026-07-25에 검토·통합했다. 같은 대상을 여러 번 수정한 경우 가장 마지막의 명시적 교정을 사용한다.

화면별 typography, spacing, copy, validation workspace, valuation, report outline과 report editor의 현재 구현값은 [`docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md`](./docs/REFLO_UI_IMPLEMENTATION_DECISIONS_v1.md)를 따른다. 과거 prototype 값과 해당 문서가 충돌하면 해당 문서가 우선한다.

