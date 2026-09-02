# UI Architecture v2

이 문서는 판도연구소 UI가 기능 추가 과정에서 다시 개별 CSS 패치의 집합으로 변하는 것을 막기 위한 강제 규칙이다. 1단계의 목적은 화면을 다시 그리는 것이 아니라 **새 부채가 생기지 않는 경계**를 먼저 세우는 것이다.

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

지도 / 추가 / 편집은 외형과 위치가 달라도 내부 shell 계약은 동일하다.

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

현재 `app.css`와 `phase1-ui-cleanup.css`는 UI v2 계층 분리 이전의 legacy 파일이다. 1단계에서는 대규모 이동을 하지 않고 **Legacy CSS ratchet**으로 동결한다.

- 새 root-level CSS 파일을 추가하지 않는다.
- legacy 파일의 byte budget은 늘리지 않는다.
- 후속 UI 간소화 단계에서는 규칙을 새 계층으로 이동하면서 budget을 낮춘다.
- `phase1-ui-cleanup.css`는 추가 보정 패치를 쌓는 장소로 사용하지 않는다.
- 기존 부채가 존재한다는 이유로 새 코드에 동일한 예외를 허용하지 않는다.

이 방식은 현재 화면을 한 번에 깨뜨리지 않으면서도 새 누더기 CSS가 들어오는 것을 막기 위한 과도기 정책이다.

## 6. CI 계약

다음 검사는 모두 `pnpm test`의 일부여야 한다.

- `check:ui-spacing`: 기존 spacing/token 충돌 검사
- `check:ui-components`: primitive/component 조합 검사
- `check:ui-architecture`: 계층, Surface DOM contract, legacy ratchet 및 새 layered CSS 소유권 검사

UI 예외를 추가해서 검사를 우회하는 것보다 기존 primitive/component를 확장하는 것을 우선한다. 예외가 필요한 경우 이유가 코드에 남아야 하며 범위는 최소여야 한다.

## 7. 후속 단계와의 경계

이 단계에서는 UI를 대규모로 재배치하거나 기능 동작을 바꾸지 않는다. 다음 단계에서 Surface/Section/Field/ActionList 등의 공통 component로 실제 CSS와 DOM을 이동하면서 legacy budget을 지속적으로 낮춘다.
