# 공통 UI 규칙 적용 감사

2026-09-09. 규격 원본은 [UI Architecture v2](ui-architecture-v2.md)다. 구현·검사 결과와 미검증 항목을 구분하며 전체 QA 완료 선언이 아니다.

## 삭제한 계약과 현재 소유권

| 대상 | 삭제 / 대체 | 담당 |
|---|---|---|
| 독립 추가 Surface | 추가 header/닫기/drag handle, drawer/sheet selector, snap 상태, Surface mapping 제거 | index.html, surface-controller.js, mobile-sheet-controller.js |
| 추가 메뉴 열기 | 모든 폭에서 레이어 버튼의 popover; 메뉴가 레이어 활성 상태를 바꾸지 않음 | app.js, components/panels.css |
| 생성 route | 없는 탭/route wrapper 규칙 제거; 현재 registry의 생성 7개와 라이브러리 1개 유지 | DOM, panels.css, app.css |
| 메뉴 접근성 | menu/menuitem, expanded/controls, 방향키/Home/End, Escape/Tab/바깥 클릭, 작업 진입 시 포커스 인계 | app.js |
| 과거 추가창 검사 | 3-Surface / mobileCreate 버튼 / 생성 drawer 기대를 현재 2-Surface + 메뉴 계약으로 교체 | architecture, navigation/modeless/browser tests |
| 레이어 공통 외형 | feature의 padding/background/border/shadow를 component로 이관 | components/content.css, features/layer-panel.css |
| ID 기반 UI 보정 | 실제 semantic class로 app 및 canonical selector를 함께 변경 | app.css, editor-shell.css, modals.css |
| 스크롤 gutter 차감 | scrollbar 폭 측정 토큰과 창별 차감 제거 | surface-metrics.js, surface.css, modals.css |
| 스크롤 표시 | native scrollTop/wheel/touch를 유지하고 공간을 차지하지 않는 overlay thumb 제공 | overlay-scrollbars.js, surface.css |
| 헤더 실측 | 상단바·헤더 높이만 공통 ResizeObserver로 공급 | surface-metrics.js |
| 중복 선택 요약 검사 | 없는 요약 DOM 대신 실제 editorObjectHeader 계약 검사 | component/IA 검사 |

생성·편집 dispatch, 라이브러리 진입, 기존 버튼 ID·ARIA 연결은 보존했다. 메뉴가 닫힐 때 일반 Escape는 추가 버튼으로 돌아가고, Tab은 메뉴를 종료해 다음 탐색으로 이동한다. 생성/dialog 진입은 기존 작업의 포커스를 유지한다.

스크롤은 Surface 본문 하나가 기본 소유자다. 가상화 목록, Library 목록/상세, 높이가 제한된 추가 메뉴만 독립 스크롤 예외다. 콘텐츠 padding은 좌우 1rem이며 scrollbar는 레이아웃 폭을 차지하지 않는다. thumb의 접근성 min/max/now/controls와 키보드 Home/End/Page/Arrow 및 pointer drag 처리를 제공한다. 좁은 thumb 조작 영역 예외는 [컴포넌트 계약](ui-components-v2.md)에 기록했다.

## 확인한 브라우저 범위

로컬 앱의 DOM과 계산 스타일을 in-app browser로 확인했다.

- 360 / 390 / 430 / 800 / 1024 / 1359 / 1366 / 1920px: 추가 하위메뉴가 화면 안에 위치함.
- 위 폭에서 메뉴 열기 전후 레이어 높이와 body overflow가 동일함. 모바일 추가 메뉴는 sheet가 아님.
- 메뉴는 폭 280px, 좌우 padding 16px이며 모바일에서는 가용 높이 안에서 자체 스크롤함.
- Home/End 이동, Escape 종료·추가 버튼 포커스 복귀, Tab 종료, 바깥 검색창 클릭 종료 확인.
- 기존 Library dialog 진입 및 분포 추가 dialog 진입 확인. 분포 진입 후 combobox 포커스 유지.
- Library scrollbar End 키로 목록 끝 이동, native scrollTop / aria-valuenow / maximum이 11640으로 일치. Home 이동 확인.
- 이전 공통 규칙 확인: compact 헤더 52px·닫기 아이콘 하나, wide 레이어 280px, mobile 헤더 80px·탭48px·행/visibility44px·nav56px.
- 이전 공통 규칙 확인: 상단바48px, 파일 메뉴 열림 전후 border1px 유지, Light Library / Dark 환경설정 화면.
- 브라우저 viewport override 복원.

## 실행한 검사

- 통과: UI architecture, spacing, components, layering, information architecture.
- 통과: surface controller / metrics / tabs / overlay geometry 단위 테스트 16건.
- 통과: startup-performance 중 UI bundle / sheet compositor / map chrome 계약 3건.
- 통과: 갱신한 navigation/modeless Python 계약 9건.
- 통과: 변경 runtime JS와 새 browser contract 문법 검사.
- 통과: CSS bundle 생성, version check, git diff --check.

이전에 기록된 architecture 110건은 selector/소유권/중복 계약 및 생성물 분류를 수정해 해소했다. 생성 CSS bundle은 출력물로 분류하되 원본 CSS 14개 검사는 계속 수행한다. renderer 관련 startup 계약 3건은 이번 범위에서 변경하거나 재실행하지 않았다.

## 남은 QA

다음은 미검증이며 통과로 간주하지 않는다.

- 전체 폭 × Light/Dark 조합, 실제 browser zoom 125%, 기본 글자 확대.
- 긴 제목·단일/다중 선택, 가상화 큰 목록의 글자 확대.
- 실제 pointer/touch scrollbar drag, sheet drag/back, 스크린리더 및 modal focus trap과 overlay scrollbar 조합.
- 모든 Library/GIS/파일 메뉴의 scroll/no-scroll 대칭 및 전체 단계별 화면.
- 모든 생성 항목의 실행·취소·완료와 history/back 실브라우저 회귀.
- 갱신한 Playwright 파일 전체 실행. 이번 실제 브라우저 확인은 위에 명시한 집중 시나리오에 한정한다.

## 빌드 및 보존

앱 버전 0.33.0과 schema는 유지한다. 집중 검사 후 생성한 build ID는
`0.33.0-build-ui-common-submenu-20260909`이며 HTML/runtime/asset URL 일치를 확인했다.
기존 미커밋 GIS·데이터·렌더러 변경 및 첨부 파일은 보존했다. 커밋·푸시·배포하지 않았다.
