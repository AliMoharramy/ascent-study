# Glossary

## Personal task

A short, user-created task stored in the Ascent account's PostgreSQL database. The task belongs to one account, appears in the widget's **Mine** tab, and can be marked open or done from any connected client.

## AI task suggestion

One proposed next action generated from the account's open Today, Courses, and Mine task counts and today's focus minutes. The suggestion can be started as a focus block or copied into Mine. Personal task titles are excluded from provider requests by default; the account preference `shareTaskTitlesWithAi` must be explicitly enabled before the server may include up to 16 open titles.

## Native focus session

A server-owned Ascent focus session controlled by the Windows widget through the website's authenticated `/api/focus` endpoint. The widget displays a local 25-minute countdown derived from the server's elapsed milliseconds; the server remains authoritative for running/paused state and recorded focus time.
