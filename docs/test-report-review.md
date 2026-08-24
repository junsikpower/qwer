# 독립 리뷰 테스트 보고서

## 1. 범위와 원칙

이번 리뷰는 변경된 `AGENTS.md`와 `pomodoro-timer-PRD-v4.md`만을 기준으로 설계했다. 개발 측 테스트 산출물은 실행 대상에서 제외했고, 애플리케이션 코드는 수정하지 않았다.

독립 테스트는 `tests/review/review_app.test.js`에만 작성했다. 테스트는 애플리케이션을 별도 모듈로 import하지 않고, 단일 HTML을 브라우저와 같은 VM에 로드한 뒤 다음 외부 경계만 사용했다.

- 사용자 입력: 시작·일시정지·리셋·스킵·메모·설정·화면 이동 버튼/폼
- 관찰 결과: 표시 시간, 상태/패널 노출, 로그 목록, 탭 제목, 저장 데이터
- 환경 더블: DOM, localStorage, `Date.now()`/`performance.now()`, `visibilitychange`, Web Audio API, Notification API
- 시간 경과: 실제 대기 대신 벽시계와 monotonic 시계를 독립적으로 전진시켜 PRD의 시간 기반 상태 전이를 재현

모든 케이스명에 기대값의 근거가 되는 PRD 조항을 기록했으며, skip/xfail/todo는 사용하지 않았다.

## 2. 독립 테스트 설계 및 PRD 대응

| 테스트 ID | 근거 조항 | 검증 내용 |
| --- | --- | --- |
| REV-STRUCT-01 | 3.2, 12.1, NFR-02, NFR-03 | 단일 HTML, 인라인 스크립트/SVG, 외부 네트워크 리소스·서버 프레임워크 부재 |
| REV-FR01-01 | FR-01 | 기본 표시, 시작·일시정지·리셋, 절대시각 기반 경과 및 Paused 스냅샷 고정 |
| REV-FR01-02 | FR-01, BR-03 | 3개 소모 슬롯 상태에서 리셋해도 슬롯 수 보존 |
| REV-FR02-01 | FR-02, EC-01 | 허용된 Notification과 합성음의 동시 호출 |
| REV-FR02-02 | FR-02, EC-01 | Notification 미지원과 오디오 실패 시 탭 제목 폴백 |
| REV-FR03-01 | FR-03, FR-05, BR-04 | Focus 만료 시 완료 카운트·메모 대기, 메모 제출 후 Short Break 자동 시작, 제어 버튼 숨김 |
| REV-FR03-02 | FR-03, BR-01 | Break 만료 시 메모 없이 Focus 자동 시작 |
| REV-FR03-03 | FR-03, BR-01 | 네 번째 Focus 슬롯 소모 후 Long Break 전환 |
| REV-FR04-01 | FR-04, BR-01 | Focus 스킵 시 완료 카운트·메모 없이 슬롯만 소모하고 다음 세션 시작 |
| REV-FR04-02 | FR-04, BR-01 | Focus 2회 스킵 + 정상 완료 2회가 Long Break와 완료 개수 2로 귀결 |
| REV-FR05-01 | FR-05 | 빈 메모 제출과 `메모 없음` 표시 |
| REV-FR06-01 | FR-06 | 날짜별 완료 수와 오래된 순 메모 목록 |
| REV-FR07-01 | FR-07 | 1~180 정수 검증, 잘못된 값 저장 거부, Idle 세션 즉시 적용 |
| REV-FR07-02 | FR-07 | Running/Paused 세션의 현재 종료 시각·남은 시간 보존 |
| REV-FR08-01 | FR-08, EC-03, 13.2 | Running 타이머의 새로고침 경계 복원 |
| REV-FR08-02 | FR-08, EC-03, 13.2 | Paused 스냅샷의 오프라인 시간 무관 복원 |
| REV-EC03-01 | EC-03, BR-02 | 복수 세션 시간이 지난 Running Focus도 한 번만 종료 처리하고 메모 대기/자동 시작 금지 |
| REV-EC02-01 | EC-02 | 백그라운드 중 만료를 보류하고 visibilitychange에서 보정 |
| REV-EC04-01 | EC-04, NFR-01, 13.3-U4 | 5초 이상 wall/performance 델타 시 마지막 정상 표시를 유지한 Paused 전환과 재개 |
| REV-EC05-01 | EC-05, 13.3-U5 | localStorage 쓰기 실패 중 사용 지속·경고, 성공 후 경고 해제 |
| REV-NFR01-01 | NFR-01, 13.3-U3 | 180분 세션에서 90분 경과 후 90:00 표시로 드리프트 없는 계산 |
| REV-13.2-01 | 13.2 System Acceptance | 시작→Focus 만료→메모→Break→Focus→로그 통합 흐름 |
| REV-13.3-U1 | 13.3 User Acceptance | 실제 시간 경과를 포함한 완료·빈 메모·일별 로그 흐름 |
| REV-13.3-U2 | 13.3 User Acceptance | 설정·Running 타이머의 reload 경계 보존 |

13.1 Functional Acceptance는 FR-01~FR-08 케이스로, 13.2 System Acceptance는 `REV-FR08-01`, `REV-FR08-02`, `REV-13.2-01`로, 13.3 User Acceptance의 다섯 항목은 각각 `REV-13.3-U1`, `REV-13.3-U2`, `REV-NFR01-01`, `REV-EC04-01`, `REV-EC05-01`로 대응한다.

EC-01부터 EC-05까지 모두 독립 케이스를 설계했다. PRD의 8장과 10장에 `없음`으로 명시된 항목은 없으므로 누락으로 보고하지 않았다.

## 3. 수행 결과

실행 명령:

```text
npm run test:review
```

이 명령은 루트 Makefile의 `test-review`가 사용하는 Node 표준 테스트 실행기와 JUnit reporter를 그대로 호출한다.

환경에 `make` 실행 파일이 없어 `make test-review` 자체는 실행할 수 없었다. Makefile의 `test-review` 레시피가 호출하는 동일한 npm 명령을 직접 실행해 대체 검증했다.

결과:

- 총 테스트: 24
- 통과: 24
- 실패: 0
- 취소: 0
- skipped/xfail/todo: 0
- 결과 파일: `reports/review.xml`

따라서 실행된 독립 테스트 범위의 판정은 **true**다. 실행 결과에 결함 재현 케이스가 없으므로 위반 조항·파일 행·재현 조건·기대/실제 대조 보고 대상은 없다.

## 4. 미실행 항목

다음 항목은 테스트 코드에서 건너뛰지 않고, 실행 환경 제약으로 별도 미실행으로 기록한다.

- 실제 Chrome/Edge/Firefox 최신 데스크톱에서 `file://`로 여는 브라우저 UI 검증: 사용 가능한 브라우저 인스턴스가 없어 미실행
- OS/브라우저 설정에 따른 실제 Notification 화면 표시: PRD 3.2에서 JavaScript 감지·보정 대상이 아니며, Notification 응답 계약만 더블로 검증
- 실제 수 시간 대기 기반 장시간 테스트: 자동화된 시계 더블로 절대시각 계산을 검증했으며, 실제 장시간 대기는 미실행
- `git diff` 기반 최신 커밋 비교: 작업 디렉터리에 `.git` 저장소가 없어 미실행. 현재 파일과 PRD 기반 검토는 수행함

위 미실행 항목은 통과로 집계하지 않았다.
