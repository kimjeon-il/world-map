# UI Architecture v2

이 문서는 판도연구소 UI가 기능 추가 과정에서 다시 개별 CSS 패치의 집합으로 변하는 것을 막기 위한 강제 규칙이다. UI v2의 목적은 화면을 다시 그리는 것이 아니라 **새 부채가 생기지 않는 경계와 canonical owner를 유지하는 것**이다.

## 1. 계층과 책임

정식 의존 방향은 다음 한 방향만 허용한다.

**Tokens → Primitives → Components → Layout → Features**

- **Tokens**: 색상, 간격, 글꼴, 높이, radius, shadow 같은 의미 토큰의 원본이다.
- **Primitives**: button, input, tab, row, icon 등 최소 UI 단위의 외형과 상호작용을 소유한다.
- **Components**: surface, section, field, action list, tree, dialog 같은 조합 단위를 소유한다.
- **Layout**: wide / compact / mobile에서 위치, 크기, 표시 방식만 결정한다. 컴포넌트의 색상이나 skin을 바꾸지 않는다.
- **Features**: 국가, 수계, 라이브러리처럼 도메인에만 필요한 표현을 추가한다. 공통 컴포넌트의 skin을 다시 만들지 않는다.

새 CSS를 분리할 때는 `assets/css/{tokens,primitives,components,layout,features,utilities}/` 중 책임에 맞는 위치를 사용한다. 루트 CSS 파일을 새로 추가하지 않는다.

## 2. Property ownership

공통 컴포넌트가 소유한 시각 속성은 feature가 다시 선언하지 않는다.

- Button/Field/Tab: control height, padding, border, radius, background, focus/pressed state
- Section/Card: padding, border, radius, background, shadow
- Surface/Header/Tabs: surface chrome, header/tabs 높이와 기본 rail
- Layout: position, inset, width/height, transform, responsive visibility
- Feature: 도메인 고유 geometry/media 표현과 콘텐츠 배치

특수 미디어 preview처럼 feature가 skin 성격의 속성을 반드시 가져야 하는 경우에는 `check-ui-architecture.mjs`의 명시적 예외에 **파일 + selector + property + reason**을 모두 기록한다. 넓은 selector나 feature 전체를 예외 처리하지 않는다.

## 3. Selector와 값 규칙

새 layered CSS에는 다음 규칙을 적용한다.

- UI 스타일에 ID selector를 사용하지 않는다. ID는 JS 연결과 ARIA 참조용이다.
- `!important`는 기본적으로 금지한다. 불가피하면 좁은 명시적 예외와 이유가 필요하다.
- spacing/geometry에 임의 px 값을 추가하지 않고 semantic `--ui-*` token을 사용한다.
- 색상 literal은 token 계층에서만 정의하고 그 밖의 계층은 변수로 참조한다.
- Layout CSS는 색상, border, background, shadow, typography를 재정의하지 않는다.
- Feature CSS는 공통 component의 padding/border/radius/background/shadow를 재생성하지 않는다.

허용 예:

```css
/* components/surface.css */
.ui-surface-header {
  min-height: var(--ui-surface-header-height-compact);
  padding-inline: var(--ui-surface-content-rail-x);
  background: var(--surface-elevated);
}

/* layout/mobile.css */
[data-layout="mobile"] .workspace-surface {
  width: 100%;
  transform: translateY(100%);
}
```

금지 예:

```css
/* features/editor.css */
#rightPanel .country-editor {
  padding: 13px;
  border-radius: 11px;
  background: #20262e;
}
```

## 4. Surface DOM contract

지도 / 만들기 / 편집은 외형과 위치가 달라도 내부 shell 계약은 동일하다.

```text
workspace-surface
  surface-header
    surface-header-title
    surface-header-actions
  surface-tabs
  surface-body
    surface-content
```

현재 canonical surface는 다음 세 개다.

- `#leftPanel.surface-map`
- `#createMenu.surface-create`
- `#rightPanel.surface-editor`

각 tab button은 `.ui-button.ui-tab`을 조합하고 `data-surface-tab`으로 의미를 선언한다. Wide에서 창 모양을 다르게 만드는 것은 Layout 책임이며, feature별로 header/tabs/body 순서를 바꾸지 않는다.

## 5. Legacy CSS ratchet

`phase1-ui-cleanup.css`와 해당 runtime loader는 UI v2 convergence 단계에서 제거되었다. 현재 root-level legacy stylesheet로 허용되는 것은 `app.css` 하나뿐이다.

- 새 root-level CSS 파일을 추가하지 않는다.
- `app.css`의 byte budget은 늘리지 않는다.
- generic UI 규칙은 layered CSS로 이동하면서 `app.css` budget을 계속 낮춘다.
- layered UI에 legacy 파일과 같은 selector/override 부채를 다시 만들지 않는다.
- 기존 부채가 존재한다는 이유로 새 코드에 동일한 예외를 허용하지 않는다.

이 ratchet은 남은 `app.css`를 점진적으로 축소하면서도 현재 renderer/domain 표현을 한 번에 깨뜨리지 않기 위한 경계다.

## 6. Runtime ownership

정적 presentation은 HTML/CSS가 소유하고, 동적 UI state는 해당 controller가 소유한다.

- Surface open/close, `aria-hidden`, `inert`: `surface-controller.js`
- Mobile sheet snap과 직접 편집 전환: `mobile-sheet-controller.js`
- Toast/feedback routing: `feedback-controller.js`
- Dialog focus containment/restore: dialog controller 및 `dialog-accessibility-controller.js`
- Library listbox selection/keyboard: `historical-library-controller.js`
- 공통 UI initialization: `ui-runtime.js`

문자열이나 렌더된 DOM을 관찰해서 domain state를 역추론하는 방식보다 명시적 controller state와 event를 우선한다.

## 7. CI 계약

다음 검사는 모두 `pnpm test`의 일부여야 한다.

- `check:ui-spacing`: spacing/token 충돌 검사
- `check:ui-components`: primitive/component 조합 검사
- `check:ui-architecture`: 계층, Surface DOM contract, legacy ratchet 및 retired artifact 검사

UI 예외를 추가해서 검사를 우회하는 것보다 기존 primitive/component를 확장하는 것을 우선한다. 예외가 필요한 경우 이유가 코드에 남아야 하며 범위는 최소여야 한다.

## 8. 후속 정리 경계

UI v2의 전용 phase cleanup layer는 더 이상 production runtime에 존재하지 않는다. 이후 UI 정리는 `app.css`의 남은 generic rule을 canonical layered CSS로 이동하고, static markup으로 옮길 수 있는 presentation mutation을 줄이는 방식으로 진행한다.

기능/domain state와 renderer를 UI 정리와 동시에 재작성하지 않는다.
