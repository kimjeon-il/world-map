# UI Surface State v2

3단계의 목적은 지도·추가·편집의 열기/닫기와 반응형 전환을 기능별 분기 대신 하나의 `SurfaceController` 상태 계약으로 관리하는 것이다.

## 상태 원칙

Surface는 `layers`, `create`, `editor` 세 canonical name을 사용한다. 상태에는 현재 열림 여부와 함께 열림의 출처를 기록한다.

- `user`: 사용자가 탐색 버튼, 편집 버튼 등으로 직접 연 상태
- `automatic`: 객체 선택 같은 기능 흐름이 보조적으로 연 상태
- `restored`: 화면 폭 전환 과정에서 사용자 상태를 복원한 상태

`open()`, `close()`, `toggle()`, `syncLayout()`이 이 상태의 유일한 소유자다. Feature 코드는 DOM의 `mobile-open`, `collapsed`, `hidden`을 직접 상태로 사용하지 않는다.

## 자동 열기 정책

편집기는 선택 결과를 보여주기 위해 자동으로 열릴 수 있지만 사용자 의도를 덮어쓰지 않는다.

- Wide/Compact: 자동 editor open을 허용한다.
- Mobile: 객체 선택만으로 editor bottom sheet를 열지 않는다.
- 사용자가 editor를 수동으로 닫은 상태에서는 이후 자동 open을 억제한다.
- 사용자가 editor를 직접 열면 자동-open 억제 상태를 해제한다.

현재 `editorManuallyCollapsed`는 기존 `app.js` 호환을 위한 alias이며 실제 원본은 `automaticOpenBlocked.editor`다. 후속 리팩터링에서 feature 쪽 직접 접근을 제거한다.

## Responsive 전환

반응형 전환은 document 상태와 지도 상태를 건드리지 않고 Surface presentation만 변환한다.

- Wide의 영구 layer panel은 Mobile bottom sheet로 자동 승격하지 않는다.
- 사용자가 직접 열어 둔 create/editor는 가능한 경우 다음 layout에서도 유지한다.
- 자동으로 열린 editor는 Mobile로 전환할 때 bottom sheet로 승격하지 않는다.
- Mobile에서는 한 번에 하나의 Surface만 열린다.
- Compact에서도 transient Surface는 상호 배타적이다.

## Presentation 책임

`SurfaceController`는 의미 상태를 계산하고 `render()`에서 공통 presentation class/ARIA만 동기화한다.

- Wide: persistent map panel + floating editor/create presentation
- Compact: drawer presentation
- Mobile: bottom-sheet presentation

화면 폭에 따른 실제 위치와 크기는 CSS `layout/` 계층의 책임이며 feature 로직이 직접 결정하지 않는다.

## 호환 브리지

현재 `app.js`에는 mobile sheet browser-history wrapper와 다중 선택 `편집` 버튼이 기존 방식으로 남아 있다. 3단계에서는 Controller가 다음 호환만 좁게 제공한다.

- 차단된 Mobile automatic open이 불필요한 browser-history entry를 만들지 않도록 기존 history marker를 한 호출 동안 보호한다.
- `multiEditBtn`에서 발생한 automatic helper 호출은 실제 사용자 클릭으로 판별해 명시적 editor open으로 취급한다.

이 브리지는 상태 원본이 아니다. 후속 application/UI controller 분리 단계에서 `app.js` wrapper가 Surface API를 직접 사용하게 되면 제거한다.

## 검증 계약

`tests/unit/surface-controller.test.mjs`는 최소한 다음을 고정한다.

- Compact/Mobile의 Surface 상호 배타성
- Mobile automatic editor open 차단
- explicit editor open 허용
- manual close 이후 automatic reopen 억제
- user/automatic origin 추적
- Wide persistent layer가 Mobile sheet로 변환되지 않음
- automatic editor가 Mobile 전환 시 sheet가 되지 않음
- user-opened editor/create의 responsive 상태 보존
