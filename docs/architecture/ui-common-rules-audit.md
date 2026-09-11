# 공통 UI 규칙 적용 감사

## 잔여 Tooltip·스크롤바·Toast·GIS 검사 (2026-09-09)

- 키보드 Tooltip은 mobile/coarse-pointer에서도 표시하며 터치 hover는 제외한다. Escape와 기존 닫힘 조건을 유지하고 기존 `aria-describedby` 연결은 보존한다.
- dialog 스크롤바를 dialog 직속 비스크롤 overlay로 이동했다. viewport 좌표를 dialog 기준 좌표로 환산하고 최상위 dialog 이외 track은 숨긴다. 확인창의 Tab 처리는 기존 confirmation controller만 담당한다.
- 시트 dragging/settling 동안에만 frame 추적을 수행한다. 종료·취소·숨김·dispose 시 지속 추적을 중단한다.
- Toast는 박스를 확대하지 않고 이동/삭제/저장/선택 요청 문구와 긴 국가명 나열을 압축했다. 알려진 오류는 필요한 조치를 남기고 알 수 없는 오류·경고는 일괄 실패/완료 문구로 대체하지 않는다. 원문 ARIA와 기존 진단 경로·timeout은 유지한다. 외부에서 들어오는 임의의 긴 오류까지 말줄임이 없어졌다는 의미는 아니다.
- 기존 GIS 모바일 검사를 현재 `데이터 선택 → 가져오기 설정 → 확인`과 `subunit` 계약으로 갱신했다. 단계 왕복 시 국가·유형·이름 매핑 유지 검사가 통과했다.
- 재현용 브라우저 검사 3건은 수정 전 모두 실패했고 수정 후 통과했다. 좁은 폭 Toast 표시 검사까지 새 4건 통과, 실제 짧은 Library 4개 viewport 회귀와 GIS 단계 이동 검사도 통과했다. 실제 앱 Library의 내부 track·좌표 정렬·Home/End·닫힘을 브라우저 스킬로 확인했다.
- 관련 단위 14건, UI 정적 검사 전체, 변경 JS 문법·ESLint를 통과했다. 확장 실행한 `ui-controllers.test.mjs`의 확인창/레이어 모형은 각각 `HTMLElement` 부재와 tree element 부재로 실패하며 이번 범위에서 수정하지 않았다. Tooltip 모형의 getAttribute 계약은 보완하고 해당 검사를 통과했다.
- 실제 터치 기기·가상 키보드·전체 테마/확대 조합과 모든 중첩 dialog 조합은 미검증이다. 드래그 위치 회귀는 controller 상태와 transform을 사용하는 격리 검사이며 전체 touch gesture 검증과 구별한다.
- 앱 버전/schema/build ID 유지, CSS bundle 재생성. 무관한 미커밋 변경 보존. 커밋·푸시·배포하지 않음.

## 공간 배분·가시성 통합 수정 (2026-09-09)

- wide 작업 공간 내비게이션은 `display: none`으로 표시·키보드·접근성 탐색에서 제외했다. compact/mobile 공유 버튼과 모바일 닫기 버튼 숨김은 유지한다. 대체 버튼과 편집창 접기 복구는 추가하지 않았다.
- Surface 로컬 불투명 배경, 공통 헤더 경계선 소유권, 레이어 primary 막대/secondary 약한 선택, 반복 유형·swatch 제거를 반영했다. 검색 결과 유형과 수계 로딩/오류 안내는 유지한다.
- Library 필터는 기본 접힘을 폐기했다. 후속 요청에 따라 첫 줄은 이름 검색 + 기준 연도, 다음 줄은 종류·상태·지역의 상시 표시 grid로 구성한다. 범위 선택은 접기 없는 필드이며 footer는 내용 높이만 차지한다.
- 360×740 로컬 화면: 목록 본문 약 355px, 상세 footer는 범위 없는 경우 약 61px / 범위 있는 경우 약 137px. 제목·본문·액션의 좌우 rail은 1rem이다.
- GIS export 단일 폼을 유지하고 본문 스크롤과 footer를 분리했다. 정상 선택 중복 요약은 숨기되 빈 선택 안내는 유지한다. GIS 처리 로직은 변경하지 않았다.
- 모바일 추가 메뉴·투영·토글·슬라이더는 48px 최소 조작 높이, 레이어 visibility는 기존 44px 예외다. 국기·지도에서 보기 버튼의 별도 작은 크기 규칙을 제거하고 공통 버튼을 사용한다.
- 검증: 관련 단위 29건, `pnpm check:ui` 전체, JS 문법 검사 통과. 새 브라우저 회귀의 폭별 노출/메뉴, 짧은 Library, GIS export, Light/Dark 조작 높이·기본 글자 125% 확대 및 기존 모바일 손잡이 검사가 통과했다.
- 기존 GIS integration 테스트는 현재 단계명/유형 계약과 다른 기대가 있어 실패했다. 현재 계약을 사용하는 별도 GIS 단계 이동·뒤로가기·취소 smoke는 통과했다. Library 검색·선택·실제 추가·원본 보존·undo와 GIS 선택 항목 내보내기 테스트도 통과했다. Library 테스트의 비동기 get 호출과 처리 대기 시간을 실제 API에 맞췄으며 처리 pipeline은 수정하지 않았다.
- build ID: `0.33.0-build-ui-space-visibility-20260909`. 앱 버전과 schema는 유지한다. build metadata와 두 CSS bundle은 생성 스크립트로 갱신한다.
- 최종 생성물 기준: `ui-space-visibility.spec.mjs` 5건 모두 통과(2.6분). 별도 Library 추가/undo·GIS 실제 export·모바일 손잡이 3건 통과. 관련 ESLint·JS 문법·version/bundle 일치·`git diff --check`도 통과했다. 브라우저 자체 zoom 등 미검증 조합은 아래 제한을 그대로 적용한다.
- 미검증: 브라우저 자체 125% zoom, 모든 테마×폭 조합의 시각 대비, 가상 키보드, 모든 객체 유형·긴 이름 조합. 기본 글자 125% 검사는 브라우저 zoom 검사와 구별한다.
- 원본 데이터·GIS·렌더러의 기존 무관한 변경과 첨부 파일을 보존했다. 커밋·푸시·배포하지 않는다.

## 후속 수정: 하단 추가 버튼과 세로 사이드바 제거

- 추가 진입은 모든 폭에서 레이어 하단 `[+] [잠금] [삭제]` 순서다. 검색창은 독립 한 줄이며 추가 버튼은 아이콘만 표시한다.
- 하단 버튼은 desktop/compact 최소 36px, mobile 최소 48px, 간격 8px이다. 기존 메뉴 접근성 및 생성 진입을 유지한다.
- wide 세로 내비게이션 전용 CSS와 72px rail/nav/active 토큰을 제거했다. 레이어 dock은 왼쪽 0에서 시작하고, compact/mobile 내비게이션은 유지한다.
- 검색·추가 wrapper 및 옛 검사 기대를 제거하고 하단 소유권·토큰 부재 단위 검사를 추가했다.
- 브라우저 확인: 1366/1920, 800/1024/1359, 360/390/430px에서 버튼 크기와 메뉴 화면 내 위치, 위쪽 열림, Escape 종료 확인. 1366px에서 dock 왼쪽 0과 버튼 간격 8px 확인.
- 통과: 관련 단위 테스트 11건, UI architecture/spacing/components/layering/IA, app.js 문법, bundle/version, diff 공백 검사.
- 이번 후속 수정의 Light/Dark 전체 조합·확대 125%·긴 목록 스크롤·전체 키보드/생성 흐름은 미검증이다. 아래의 이전 검사 결과와 구분한다.
- build ID: `0.33.0-build-ui-layer-footer-20260909`. 앱 버전/schema 유지. 커밋·푸시·배포하지 않음.

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
