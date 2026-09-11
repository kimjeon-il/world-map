# 전 세계 하천 연결성 조사·복구 — 2026-09-06

## 결과

현재 표시 대상 전체를 조사했다. HydroRIVERS 원본 9개 권역의 Shapefile 구성 파일은
기존 manifest의 SHA-256과 일치한다. 현재 배포 자산은 production Worker decoder로
902개 pack, 3개 shard, 16,548개 feature를 해제하고 길이·해시·gzip·범위를 검증했다.

- 원본 하천 구간: **508,255개**
- 예상 하류 연결: **504,437개**; 정상 원본 종점: **3,818개**
- 연결 불일치: **151건**; 복구: **149건**; 자동 복구 제외: **2건**
- 수정된 끝점: **170개**, 하천 fragment: **159개**
- 나머지 **16,389개 객체**의 geometry·너비 배열·metadata는 그대로 유지했다.
- feature 순서·ID·이름·표시 단계, 호수, 국가 geometry, 사용자 프로젝트는 변경하지 않았다.

| 처리 순서 | 권역 | 발견 | 복구 | 남음 |
|---|---|---:|---:|---:|
| 1 | 유럽·중동 eu | 17 | 17 | 0 |
| 2 | 아시아 as | 37 | 37 | 0 |
| 3 | 시베리아 si | 0 | 0 | 0 |
| 4 | 아프리카 af | 23 | 21 | 2 |
| 5 | 남미 sa | 54 | 54 | 0 |
| 6 | 북미·중앙아메리카·카리브 na | 19 | 19 | 0 |
| 7 | 북미 북극권 ar | 0 | 0 | 0 |
| 8 | 오세아니아 au | 1 | 1 | 0 |
| 9 | 그린란드 gr | 0 | 0 | 0 |

`baseline.json`은 복구 전의 원본 NEXT_DOWN/좌표와 최종 표시 좌표를 대조한 기록이다.
151건 중 127건은 국경 보정된 연결부를 포함하고, 24건은 나머지 chain 연결 불일치다.
`cause`는 이 비교로 구분한 진단 범주이며, 과거 빌드의 중간 산출물이 남아 있지 않아
각 건이 발생한 과거 코드 실행 순간까지 재현한 분류는 아니다.

`repair.json`은 원본 ID, 연결 대상, 수정 전후 좌표, 권역별 결과, 최종 직렬화 검증을 담는다.
보고서의 거리 단위는 끝점 평균 위도를 사용하는 국소 거리(m)이며, 지도 분할 workspace에서
측정한 거리와 약간 다르다. 크로아티아 두 접점은 NEXT_DOWN으로 특정한 실제 하류 시작점을
사용했다. 임의의 최근접 국경점으로 연결하지 않았다.

## 자동 복구 제외 2건

| source → NEXT_DOWN | 원래 합류점 | 표시 끝점 간 거리 | 보존 이유 |
|---|---|---:|---|
| 10469001 → 10467476 | -12.239583, 14.760417 | 약 2,463m | 서로 다른 국경 보정 anchor 충돌 |
| 11300956 → 11301461 | 30.422917, -15.622917 | 약 1,994m | 같은 합류점으로 들어오는 여러 경로의 국경 보정 anchor 충돌 |

이 두 건은 임의로 국경 보정선을 이동시키지 않고 남겼다. 따라서 **전 세계 모든 틈이
해결된 것은 아니다.** 동일 합류점에서 보존할 국경 형상과 접점 표현을 별도로 결정해야 한다.

## 재현 방법

공식 원본: https://www.hydrosheds.org/products/hydrorivers

기존 자산의 선택·명칭·호수 정책을 다시 계산하지 않도록 동결된 pack을 기존 encoder로
재생성했다. 새 원본 빌드도 동일한 `hydro_connectivity` 연결 함수를 사용한다.
각 권역의 검사 순서와 최종 asset의 기존 기록 순서는 별개다.

```powershell
node tools/decode-hydro-connectivity.mjs <기존-asset-dir> <baseline.json>
python tools/audit-hydro-connectivity.py --baseline <baseline.json> --sources <공식-zip-cache> --report <baseline-report.json>
python tools/repair-hydro-connectivity.py --baseline <baseline.json> --sources <공식-zip-cache> --output <새-staging-dir> --report <repair-report.json>
node tools/decode-hydro-connectivity.mjs <새-staging-dir> <staged-decoded.json>
python tools/verify-hydro-connectivity.py --baseline <baseline.json> --staged <staged-decoded.json> --sources <공식-zip-cache> --report <repair-report.json>
```

staging 재생성은 저장소 밖의 존재하지 않는 출력 경로만 허용한다.
원본 zip·해제 자료·baseline JSON은 로컬 임시 작업 디렉터리에 보관하고 Git에는 넣지 않는다.

## 검증

- 전 세계 직렬화 후 자동 복구 가능 틈 **0건**, 새로 끊긴 연결 **0건**.
- 하천 연결 단위 테스트 9개: 본류·지류 합류, 여러 지류, 역방향 anchor 보존, 원본 불일치·거리 초과·다른 수계 거부, 자연 종점, 입력 순서 독립성, 멱등성, split source, fresh generator 연결.
- 크로아티아 약 **824km²·1,087km²** 후보 복원, 세르비아 약 **9,022·9,036·4,228km²** 후보 보존.
- 동일 브라우저 세션: 지연된 최초 수계 로딩 → 세르비아 세 조각 선택·미리보기·취소 → 크로아티아 두 조각 → 평면·지구본 전환 → 선택·미리보기·취소 통과. 수집된 브라우저 오류 없음.

앱 `0.32.0`, 수계 포맷/버전 `0.13.0` 유지.
새 data revision: `data-8c6791b296acb7270abf5edc37e24f98`.
전체 앱 회귀·성능 전수 측정·커밋·푸시·배포는 수행하지 않았다.
