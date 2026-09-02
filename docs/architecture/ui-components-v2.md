# UI Components v2

2단계의 목적은 지도·추가·편집 화면의 공통 UI를 기능별 보정 CSS가 아니라 동일한 component 계약으로 렌더링하는 것이다. 기능 동작과 데이터 모델은 이 단계의 범위가 아니다.

## Canonical style sources

공통 UI의 새 원본은 다음 layered CSS다.

- `assets/css/tokens/ui-v2.css`: Surface와 콘텐츠 component가 공유하는 의미 토큰
- `assets/css/components/surface.css`: Surface/Header/Tabs/Body/Content
- `assets/css/components/content.css`: Section/Field/ActionList/PropertyList/ObjectContext 호환 계약
- `assets/css/layout/surfaces.css`: wide/compact/mobile의 Surface 배치와 표시 상태

`app.css`는 기존 화면을 유지하기 위한 legacy compatibility source다. 새 공통 component 규칙을 `app.css`나 `phase1-ui-cleanup.css`에 추가하지 않는다.

## Surface contract

지도, 추가, 편집은 모두 다음 shell을 사용한다.

```text
workspace-surface
  surface-header
    surface-header-title
    surface-header-actions
  surface-tabs
  surface-body
    surface-content
```

Surface 내부 구조와 기본 chrome은 `components/surface.css`가 소유한다. Wide/Compact/Mobile의 위치·크기·열림 상태는 `layout/surfaces.css`가 소유한다.

Wide에서는 용도별 외형 차이를 유지할 수 있다.

- 지도: 좌측 workspace surface
- 추가: 작은 floating surface
- 편집: 우측 editor surface

Compact와 Mobile에서는 같은 Surface 구조와 sizing grammar를 사용한다.

## Content components

편집기 및 이후 추가되는 기능은 다음 의미 단위를 우선 사용한다.

- `ui-content-section`: 관련 필드/정보의 한 묶음
- `ui-content-field`: label + control 한 쌍
- `ui-action-list`: 실행 가능한 작업의 세로 목록
- `ui-property-list`: 읽기 전용 속성 목록
- `ui-object-context`: 현재 편집 대상을 설명하는 이름/종류/상태 영역

현재의 `editor-*` 클래스는 기존 DOM 호환을 위해 component stylesheet에서 alias로 취급한다. 신규 기능은 새 `ui-*` component 이름을 사용하고 기존 feature 전용 skin을 복제하지 않는다.

## Scroll ownership

Surface shell 자체가 여러 중첩 스크롤 영역을 만들지 않는다.

- 기본 Surface는 `surface-body` 하나가 scroll owner다.
- 지도 레이어처럼 virtualized child가 스크롤을 소유해야 할 때만 `surface-body-delegated`를 사용한다.
- 좌우 rail과 scrollbar gutter는 Surface token으로 공유한다.

## Migration rule

2단계 이후 UI 변경은 다음 순서를 따른다.

1. 기존 component로 표현 가능한지 확인한다.
2. 공통 요구라면 `components/`를 확장한다.
3. 화면 폭에 따른 차이라면 `layout/`에서 처리한다.
4. 기능 고유 표현만 `features/`에 둔다.
5. legacy CSS에 새 보정 규칙을 추가하지 않는다.

`phase1-ui-cleanup.css`에서 공통 action/property/empty-state 보정은 제거하고 layered component로 이동한다. 남아 있는 cleanup 규칙은 후속 단계에서 해당 책임 계층으로 계속 이동한다.
