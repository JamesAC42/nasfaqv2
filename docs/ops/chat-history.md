# Chat history retention

Each room keeps its newest 100 active-status messages visible regardless of age, plus all active-status messages from the last 30 days. These are overlapping sets: a quiet room with 19 old messages shows all 19; a room with 101 old messages shows the newest 100; a room with 150 recent messages shows all 150. Deleted and moderated messages never count toward the minimum or appear in ordinary history.

`CHAT_HISTORY_MIN_MESSAGES` defaults to 100 (integer, bounded to 1–10000). `CHAT_HISTORY_VISIBLE_DAYS` defaults to 30. They are API environment settings, not per-user settings. Pagination applies the minimum to the whole room before applying a page cursor. Admin viewers can read older archived history as well.

The existing archive operation, invoked when history loads or by the admin archive endpoint, now preserves at least the newest 100 active-status rows per room in the active table. It still moves only older rows in bounded batches. History also reads qualifying archived rows, making previously archived quiet-room history visible without a data migration or a restore job. Preview queries already include both tables; the latest preview is always within the retained minimum.

Read/unread state references the active table. Reading an archived message advances the marker through preceding active messages; archive-only rooms can be marked read without a foreign-key error. Existing reply/report/moderation mutations still target active-table messages; this change does not add archived-message mutation support. The ordinary chat UI does not expose those actions.

## Verification

The native API test suite includes PostgreSQL integration tests when `CHAT_TEST_DATABASE_URL` is set. It must target a disposable local `nasfaq_chat_test` database as `nasfaq_test`. Tests truncate only their test chat fixture tables. CI provisions a PostgreSQL 16 service and runs these tests automatically. Never point the test suite at production.

Coverage includes the 100/101 boundary, quiet and busy rooms, archived history, stable pagination, recent archived rows, per-room limits, hidden statuses, admin history, and read markers with actual foreign-key constraints.
